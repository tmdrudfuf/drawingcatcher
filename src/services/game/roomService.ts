import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase, supabaseConfigError } from '@/providers/supabase/supabase';
import { FAKE_PROMPTS } from '@/services/game/fakeData';
import type { Player, RoundPhase, SketchVariant } from '@/types/game';

type GameStatus = 'waiting' | 'active' | 'ended';
type RemoteRoundStatus = 'prompt' | 'drawing' | 'judging' | 'results' | 'reveal' | 'complete';

interface GameRow {
  id: string;
  room_code: string;
  status: GameStatus;
  host_player_id: string;
  current_round_number: number;
}

interface PlayerRow {
  id: string;
  display_name: string;
}

interface GamePlayerRow {
  game_id: string;
  player_id: string;
  slot: 1 | 2;
  ready: boolean;
  wants_next_round: boolean;
  players: PlayerRow | null;
}

interface RoundRow {
  id: string;
  game_id: string;
  round_number: number;
  prompt: string;
  status: RemoteRoundStatus;
  winner_player_id: string | null;
}

interface SubmissionRow {
  id: string;
  round_id: string;
  player_id: string;
  submitted: boolean;
  submitted_at: string | null;
  drawing_path: string | null;
}

export interface RemotePlayer extends Player {
  slot: 1 | 2;
  ready: boolean;
  wantsNextRound: boolean;
  submitted: boolean;
}

export interface RoomSnapshot {
  gameId: string;
  roomCode: string;
  status: GameStatus;
  hostPlayerId: string;
  currentRoundNumber: number;
  currentRoundId: string | null;
  prompt: string;
  phase: RoundPhase;
  players: RemotePlayer[];
  winnerPlayerId: string | null;
}

export type RoomListener = (snapshot: RoomSnapshot) => void;

function requireClient() {
  if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase is not available.');
  return supabase;
}

function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function sketchVariantForSlot(slot: 1 | 2): SketchVariant {
  return slot === 1 ? 'p1' : 'p2';
}

function toPhase(game: GameRow | null, round: RoundRow | null): RoundPhase {
  if (!game || game.status === 'ended') return 'complete';
  if (!round) return 'prompt';
  return round.status === 'complete' ? 'complete' : round.status;
}

function toRemotePlayers(rows: GamePlayerRow[], submissions: SubmissionRow[]): RemotePlayer[] {
  return rows
    .sort((a, b) => a.slot - b.slot)
    .map((row) => {
      const variant = sketchVariantForSlot(row.slot);
      const submission = submissions.find((s) => s.player_id === row.player_id);
      return {
        id: row.player_id,
        name: row.players?.display_name ?? `Player ${row.slot}`,
        slot: row.slot,
        ready: row.ready,
        wantsNextRound: row.wants_next_round,
        // A player counts as submitted only once their drawing asset exists.
        submitted: Boolean(submission?.submitted && submission?.drawing_path),
        drawing: {
          playerId: row.player_id,
          sketchVariant: variant,
          drawingPath: submission?.drawing_path ?? null,
          traits:
            variant === 'p1'
              ? ['huge oval body', 'tiny legs', 'uneven eyes', 'raised curved tail']
              : ['oversized head', 'small body', 'long thin legs', 'crooked tail', 'surprised face'],
        },
      };
    });
}

export async function fetchRoomSnapshot(gameId: string): Promise<RoomSnapshot> {
  const client = requireClient();
  const { data: game, error: gameError } = await client
    .from('games')
    .select('id, room_code, status, host_player_id, current_round_number')
    .eq('id', gameId)
    .single<GameRow>();
  if (gameError) throw new Error(gameError.message);

  const [{ data: playerRows, error: playersError }, { data: roundRows, error: roundsError }] = await Promise.all([
    client
      .from('game_players')
      .select('game_id, player_id, slot, ready, wants_next_round, players(id, display_name)')
      .eq('game_id', gameId)
      .returns<GamePlayerRow[]>(),
    client
      .from('rounds')
      .select('id, game_id, round_number, prompt, status, winner_player_id')
      .eq('game_id', gameId)
      .eq('round_number', game.current_round_number)
      .order('created_at', { ascending: false })
      .limit(1)
      .returns<RoundRow[]>(),
  ]);
  if (playersError) throw new Error(playersError.message);
  if (roundsError) throw new Error(roundsError.message);

  const round = roundRows?.[0] ?? null;
  const { data: submissions, error: submissionsError } = round
    ? await client
        .from('round_submissions')
        .select('id, round_id, player_id, submitted, submitted_at, drawing_path')
        .eq('round_id', round.id)
        .returns<SubmissionRow[]>()
    : { data: [], error: null };
  if (submissionsError) throw new Error(submissionsError.message);

  return {
    gameId: game.id,
    roomCode: game.room_code,
    status: game.status,
    hostPlayerId: game.host_player_id,
    currentRoundNumber: game.current_round_number,
    currentRoundId: round?.id ?? null,
    prompt: round?.prompt ?? '',
    phase: toPhase(game, round),
    players: toRemotePlayers(playerRows ?? [], submissions ?? []),
    winnerPlayerId: round?.winner_player_id ?? null,
  };
}

async function upsertPlayer(playerId: string, displayName: string) {
  const client = requireClient();
  const { error } = await client.from('players').upsert({ id: playerId, display_name: displayName });
  if (error) throw new Error(error.message);
}

export async function createGame(playerId: string, displayName: string): Promise<RoomSnapshot> {
  const client = requireClient();
  await upsertPlayer(playerId, displayName);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomCode = generateRoomCode();
    const { data: game, error } = await client
      .from('games')
      .insert({ room_code: roomCode, host_player_id: playerId })
      .select('id')
      .single<{ id: string }>();
    if (!error && game) {
      const { error: joinError } = await client
        .from('game_players')
        .insert({ game_id: game.id, player_id: playerId, slot: 1 });
      if (joinError) throw new Error(joinError.message);
      return fetchRoomSnapshot(game.id);
    }
    if (!error || !error.message.includes('duplicate')) {
      throw new Error(error?.message ?? 'Could not create the room.');
    }
  }

  throw new Error('Could not generate a unique room code. Try again.');
}

export async function joinGame(roomCodeInput: string, playerId: string, displayName: string): Promise<RoomSnapshot> {
  const client = requireClient();
  const roomCode = normalizeRoomCode(roomCodeInput);
  if (roomCode.length !== 4) throw new Error('Enter a 4-character room code.');

  await upsertPlayer(playerId, displayName);

  const { data: game, error } = await client
    .from('games')
    .select('id, status')
    .eq('room_code', roomCode)
    .maybeSingle<{ id: string; status: GameStatus }>();
  if (error) throw new Error(error.message);
  if (!game) throw new Error('No room found with that code.');
  if (game.status === 'ended') throw new Error('That game already ended.');

  const { data: existingRows, error: rowsError } = await client
    .from('game_players')
    .select('player_id, slot')
    .eq('game_id', game.id)
    .returns<{ player_id: string; slot: 1 | 2 }[]>();
  if (rowsError) throw new Error(rowsError.message);

  const alreadyJoined = existingRows?.find((row) => row.player_id === playerId);
  if (!alreadyJoined) {
    // Only brand-new joiners are gated on room state; a returning player always
    // gets their snapshot back so reconnect works mid-game.
    if (game.status !== 'waiting') throw new Error('That game has already started.');
    if ((existingRows?.length ?? 0) >= 2) throw new Error('That room is full.');
    const taken = new Set(existingRows?.map((row) => row.slot));
    const slot: 1 | 2 = taken.has(1) ? 2 : 1;
    const { error: joinError } = await client
      .from('game_players')
      .insert({ game_id: game.id, player_id: playerId, slot });
    if (joinError) {
      throw new Error(
        joinError.message.includes('duplicate') ? 'That room just filled up.' : joinError.message,
      );
    }
  }

  return fetchRoomSnapshot(game.id);
}

export async function setReady(gameId: string, playerId: string, ready: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('game_players').update({ ready }).eq('game_id', gameId).eq('player_id', playerId);
  if (error) throw new Error(error.message);
}

export async function startRoundIfReady(gameId: string, hostPlayerId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('start_round_if_ready', {
    p_game_id: gameId,
    p_actor_player_id: hostPlayerId,
    p_prompt: FAKE_PROMPTS[0],
  });
  if (error) throw new Error(error.message);
}

export async function beginDrawingRound(roundId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('rounds').update({ status: 'drawing' }).eq('id', roundId).eq('status', 'prompt');
  if (error) throw new Error(error.message);
}

export async function submitDrawing(
  gameId: string,
  roundId: string,
  playerId: string,
  drawingPath: string,
): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('submit_round_drawing', {
    p_game_id: gameId,
    p_round_id: roundId,
    p_player_id: playerId,
    p_drawing_path: drawingPath,
  });
  if (error) throw new Error(error.message);
}

export async function completeJudging(gameId: string, roundId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('complete_fake_judging', {
    p_game_id: gameId,
    p_round_id: roundId,
  });
  if (error) throw new Error(error.message);
}

export async function markReveal(roundId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('rounds').update({ status: 'reveal' }).eq('id', roundId).eq('status', 'results');
  if (error) throw new Error(error.message);
}

export async function requestNextRound(gameId: string, playerId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('request_next_round', {
    p_game_id: gameId,
    p_player_id: playerId,
    p_prompts: FAKE_PROMPTS,
  });
  if (error) throw new Error(error.message);
}

export async function endRemoteGame(gameId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('games').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', gameId);
  if (error) throw new Error(error.message);
}

export function subscribeToRoom(gameId: string, listener: RoomListener, onError: (message: string) => void): RealtimeChannel {
  const client = requireClient();
  const refresh = () => {
    fetchRoomSnapshot(gameId).then(listener).catch((err: Error) => onError(err.message));
  };

  const channel = client
    .channel(`game:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `game_id=eq.${gameId}` }, refresh)
    // round_submissions has no game_id column to filter on; the volume is tiny
    // (<=2 rows/round) so an unfiltered refresh is fine and is what makes the
    // "first submitter waits for the second" state actually update live.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'round_submissions' }, refresh)
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') onError('Realtime connection error. Check Supabase Realtime settings.');
    });

  return channel;
}

export function unsubscribeFromRoom(channel: RealtimeChannel): void {
  requireClient().removeChannel(channel);
}
