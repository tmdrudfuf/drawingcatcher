import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { track } from '@/services/analytics/analytics';
import { uploadDrawingPng } from '@/services/drawing/drawingAssets';
import type { CharacterizationResult } from '@/services/ai/characterization';
import type { AnimationJobState, MotionName } from '@/services/ai/animation';
import {
  getWinnerAnimationRevealStatus as fetchWinnerAnimationRevealStatus,
  type WinnerAnimationRevealResult,
} from '@/services/ai/animation/WinnerAnimationService';
import {
  getRewardedAdCorrelation as fetchRewardedAdCorrelation,
  getRewardedAdStatus as fetchRewardedAdStatus,
  type RewardedAdCorrelationResult,
  type RewardedAdStatusResult,
} from '@/services/ads';
import type { JudgeRoundResult } from '@/services/ai/judge';
import { buildRound, FAKE_PLAYERS } from '@/services/game/fakeData';
import { getGuestIdentity, rotateGuestIdentity, type GuestIdentity } from '@/services/game/guestIdentity';
import {
  beginDrawingRound,
  completeJudging,
  createGame,
  endRemoteGame,
  fetchRoomSnapshot,
  joinGame,
  markReveal,
  PlayerRegistrationError,
  registerOrTouchPlayer,
  requestNextRound,
  setReady,
  startRoundIfReady,
  submitDrawing,
  subscribeToRoom,
  unsubscribeFromRoom,
  type RemotePlayer,
  type RoomSnapshot,
} from '@/services/game/roomService';
import type { Player, PlayerId, RoundPhase } from '@/types/game';

export interface AnimationSnapshot {
  state: AnimationJobState;
  motions: MotionName[];
}

export interface GameState {
  roundNumber: number;
  prompt: string;
  players: [Player, Player];
  phase: RoundPhase;
  judgeResult: JudgeRoundResult | null;
  characterizations: Partial<Record<PlayerId, CharacterizationResult>>;
  animation: AnimationSnapshot | null;
}

const initialState: GameState = {
  roundNumber: 0,
  prompt: '',
  players: FAKE_PLAYERS,
  phase: 'prompt',
  judgeResult: null,
  characterizations: {},
  animation: null,
};

type Action =
  | { type: 'START_GAME' }
  | { type: 'BEGIN_DRAWING' }
  | { type: 'SUBMIT_DRAWINGS' }
  | { type: 'JUDGE_DONE'; result: JudgeRoundResult }
  | { type: 'CHARACTERIZE_DONE'; map: Partial<Record<PlayerId, CharacterizationResult>> }
  | { type: 'ANIMATION_UPDATE'; animation: AnimationSnapshot }
  | { type: 'NEXT_ROUND' }
  | { type: 'END_GAME' };

function startRound(roundNumber: number): GameState {
  const round = buildRound(roundNumber);
  return {
    roundNumber: round.roundNumber,
    prompt: round.prompt,
    players: round.players,
    phase: 'prompt',
    judgeResult: null,
    characterizations: {},
    animation: null,
  };
}

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'START_GAME':
      return startRound(1);
    case 'BEGIN_DRAWING':
      return { ...state, phase: 'drawing' };
    case 'SUBMIT_DRAWINGS':
      return { ...state, phase: 'judging' };
    case 'JUDGE_DONE':
      return { ...state, phase: 'results', judgeResult: action.result };
    case 'CHARACTERIZE_DONE':
      return { ...state, phase: 'characterizing', characterizations: action.map };
    case 'ANIMATION_UPDATE':
      return { ...state, phase: 'reveal', animation: action.animation };
    case 'NEXT_ROUND':
      return startRound(state.roundNumber + 1);
    case 'END_GAME':
      return initialState;
    default:
      return state;
  }
}

function remotePlayersForState(remote: RoomSnapshot | null): [Player, Player] {
  if (!remote) return FAKE_PLAYERS;
  const players = [...remote.players].sort((a, b) => a.slot - b.slot);
  const first = players[0] ?? FAKE_PLAYERS[0];
  const second = players[1] ?? {
    ...FAKE_PLAYERS[1],
    id: 'waiting-player',
    name: 'Waiting...',
  };
  return [first, second];
}

/**
 * Milestone 4B: builds the displayed JudgeRoundResult from the real Gemini
 * judge's persisted scores/comment/reasons. `players` is already slot-sorted
 * (remotePlayersForState), and the judge-round Edge Function's player1/player2
 * naming is likewise slot 1/slot 2 — so this mapping is positional, not an id
 * lookup, matching the same convention buildDeterministicJudgeResult below
 * already uses.
 */
function buildRealJudgeResult(players: [Player, Player], remote: RoomSnapshot): JudgeRoundResult {
  const summary = remote.judgeSummary!;
  return {
    players: [
      {
        playerId: players[0].id,
        score: summary.player1Score,
        recognized: true,
        observations: summary.player1Reason ? [summary.player1Reason] : [],
      },
      {
        playerId: players[1].id,
        score: summary.player2Score,
        recognized: true,
        observations: summary.player2Reason ? [summary.player2Reason] : [],
      },
    ],
    winnerPlayerId: remote.winnerPlayerId ?? players[0].id,
    comment: summary.comment,
    suspenseCues: [],
  };
}

/**
 * Fallback-only, Milestone 4B onward: used when a round was force-advanced
 * via the complete_fake_judging RPC (the client's recovery path when real
 * Gemini judging fails or times out — see JudgeScreen) and therefore has no
 * real judge data to show. Deterministic placeholder, not a claim of an
 * actual AI verdict.
 */
function buildDeterministicJudgeResult(players: [Player, Player], winnerPlayerId?: string | null): JudgeRoundResult {
  const winner = winnerPlayerId ?? players[0].id;
  return {
    players: [
      {
        playerId: players[0].id,
        score: 87,
        recognized: true,
        observations: ['cat detected', 'tiny legs', 'raised curved tail'],
      },
      {
        playerId: players[1].id,
        score: 74,
        recognized: true,
        observations: ['cat detected', 'unusually long legs', 'surprised face'],
      },
    ],
    winnerPlayerId: winner,
    comment: 'Those tiny legs somehow made the cat more powerful.',
    suspenseCues: [
      'CAT DETECTED',
      'TINY LEGS DETECTED...',
      'ANATOMY: QUESTIONABLE',
      'ARTISTIC CONFIDENCE: SOMEHOW HIGH',
    ],
  };
}

export interface GameContextValue {
  state: GameState;
  remoteRoom: RoomSnapshot | null;
  remotePlayers: RemotePlayer[];
  localPlayerId: string | null;
  localPlayer: RemotePlayer | null;
  isHost: boolean;
  isRemoteGame: boolean;
  loading: boolean;
  error: string | null;
  winner: Player | null;
  loser: Player | null;
  createRoom: (displayName?: string) => Promise<boolean>;
  joinRoom: (roomCode: string, displayName?: string) => Promise<boolean>;
  toggleReady: () => Promise<void>;
  startGame: () => void | Promise<void>;
  beginDrawing: () => void | Promise<void>;
  /** Pass the exported PNG (base64, no data: prefix) in remote games. Returns success. */
  submitDrawings: (pngBase64?: string) => Promise<boolean>;
  /** Local data: URI of this device's own submitted drawing — shown without re-download. */
  localDrawingUri: string | null;
  /**
   * Milestone 4B: force-advances the round via the deterministic
   * complete_fake_judging RPC. No longer the primary judging path — the real
   * Gemini judge-round Edge Function now does that (and advances the round
   * itself on success). JudgeScreen calls this only as the failure-recovery
   * action when real judging fails or times out, so the round is never stuck.
   */
  completeRemoteJudging: () => Promise<void>;
  markRemoteReveal: () => Promise<void>;
  reportJudgeResult: (result: JudgeRoundResult) => void;
  reportCharacterizations: (map: Partial<Record<PlayerId, CharacterizationResult>>) => void;
  reportAnimation: (animation: AnimationSnapshot) => void;
  getWinnerAnimationRevealStatus: () => Promise<WinnerAnimationRevealResult>;
  /**
   * Requests a short-lived, single-use, server-issued opaque token for a
   * rewarded ad's SSV correlation (see rewarded-ad-ssv/index.ts and the
   * M4E migration). This is authorization PREPARATION only -- it never
   * grants an entitlement itself; only a later, cryptographically verified
   * Google SSV callback can do that.
   */
  getRewardedAdCorrelation: () => Promise<RewardedAdCorrelationResult>;
  /**
   * Read-only check for "has a verified Google SSV callback granted a
   * rewarded_ad entitlement yet?". Never starts animation generation and
   * never calls animate-winner's 'start' action -- see the M4E step 3
   * report. Intended for a manual/bounded one-shot check, not polling.
   */
  getRewardedAdStatus: () => Promise<RewardedAdStatusResult>;
  nextRound: () => void | Promise<void>;
  endGame: () => void | Promise<void>;
  clearError: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [localState, dispatch] = useReducer(reducer, initialState);
  const [remoteRoom, setRemoteRoom] = useState<RoomSnapshot | null>(null);
  const [identity, setIdentity] = useState<GuestIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localDrawingUri, setLocalDrawingUri] = useState<string | null>(null);
  const prevRoundRef = useRef(0);

  useEffect(() => {
    getGuestIdentity().then(setIdentity).catch((err: Error) => setError(err.message));
  }, []);

  // Remote round-lifecycle analytics + per-round local asset reset. The realtime
  // snapshot is authoritative for when a round actually begins.
  useEffect(() => {
    const n = remoteRoom?.currentRoundNumber ?? 0;
    if (n > prevRoundRef.current && n >= 1) {
      track('round_started', { round: n });
      if (n === 2) track('round_2_started');
      if (prevRoundRef.current >= 1) setLocalDrawingUri(null);
    }
    prevRoundRef.current = n;
  }, [remoteRoom?.currentRoundNumber]);

  useEffect(() => {
    if (!remoteRoom?.gameId) return;
    const channel = subscribeToRoom(
      remoteRoom.gameId,
      (snapshot) => setRemoteRoom(snapshot),
      (message) => setError(message),
    );
    return () => unsubscribeFromRoom(channel);
  }, [remoteRoom?.gameId]);

  const state = useMemo<GameState>(() => {
    if (!remoteRoom) return localState;
    const players = remotePlayersForState(remoteRoom);
    const judgeResult =
      remoteRoom.phase === 'results' || remoteRoom.phase === 'reveal' || remoteRoom.phase === 'complete'
        ? remoteRoom.judgeSummary
          ? buildRealJudgeResult(players, remoteRoom)
          : buildDeterministicJudgeResult(players, remoteRoom.winnerPlayerId)
        : null;

    return {
      ...localState,
      roundNumber: remoteRoom.currentRoundNumber,
      prompt: remoteRoom.prompt,
      players,
      phase: remoteRoom.phase,
      judgeResult,
    };
  }, [localState, remoteRoom]);

  const localPlayer = useMemo(() => {
    if (!identity || !remoteRoom) return null;
    return remoteRoom.players.find((player) => player.id === identity.playerId) ?? null;
  }, [identity, remoteRoom]);

  const isHost = Boolean(identity && remoteRoom && remoteRoom.hostPlayerId === identity.playerId);

  const runRemote = useCallback(async (task: () => Promise<void | RoomSnapshot>) => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await task();
      if (snapshot) setRemoteRoom(snapshot);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * The single registration boundary: local identity -> (rotate if legacy)
   * -> register_or_touch_player. Never loops -- a server-reported legacy
   * identity rotates and retries exactly once; a wrong secret is an
   * authorization/integrity error and is propagated, never rotated past.
   */
  const ensureIdentity = useCallback(async (displayName?: string) => {
    let next = await getGuestIdentity(displayName);
    if (!next.playerSecret) {
      next = await rotateGuestIdentity();
    }

    try {
      await registerOrTouchPlayer(next.playerId, next.displayName, next.playerSecret!);
    } catch (err) {
      if (err instanceof PlayerRegistrationError && err.code === 'legacy_identity_requires_rotation') {
        next = await rotateGuestIdentity();
        await registerOrTouchPlayer(next.playerId, next.displayName, next.playerSecret!);
      } else {
        throw err;
      }
    }

    setIdentity(next);
    return next;
  }, []);

  const getWinnerAnimationRevealStatus = useCallback(async (): Promise<WinnerAnimationRevealResult> => {
    if (!remoteRoom?.currentRoundId) {
      return {
        state: 'error',
        code: 'reveal_context_unavailable',
        message: 'Winner animation status requires an active remote round.',
        paidGenerationRequestsThisInvocation: 0,
      };
    }
    if (!identity?.playerSecret) {
      return {
        state: 'error',
        code: 'player_identity_unavailable',
        message: 'Player authorization is unavailable.',
        paidGenerationRequestsThisInvocation: 0,
      };
    }
    return fetchWinnerAnimationRevealStatus({
      gameId: remoteRoom.gameId,
      roundId: remoteRoom.currentRoundId,
      playerId: identity.playerId,
      playerSecret: identity.playerSecret,
    });
  }, [identity, remoteRoom]);

  const getRewardedAdCorrelation = useCallback(async (): Promise<RewardedAdCorrelationResult> => {
    if (!remoteRoom?.currentRoundId) {
      return {
        status: 'error',
        code: 'reveal_context_unavailable',
        message: 'Rewarded ad correlation requires an active remote round.',
      };
    }
    if (!identity?.playerSecret) {
      return {
        status: 'error',
        code: 'player_identity_unavailable',
        message: 'Player authorization is unavailable.',
      };
    }
    return fetchRewardedAdCorrelation({
      gameId: remoteRoom.gameId,
      roundId: remoteRoom.currentRoundId,
      playerId: identity.playerId,
      playerSecret: identity.playerSecret,
    });
  }, [identity, remoteRoom]);

  const getRewardedAdStatus = useCallback(async (): Promise<RewardedAdStatusResult> => {
    if (!remoteRoom?.currentRoundId) {
      return {
        status: 'error',
        code: 'reveal_context_unavailable',
        message: 'Rewarded ad status requires an active remote round.',
      };
    }
    if (!identity?.playerSecret) {
      return {
        status: 'error',
        code: 'player_identity_unavailable',
        message: 'Player authorization is unavailable.',
      };
    }
    return fetchRewardedAdStatus({
      gameId: remoteRoom.gameId,
      roundId: remoteRoom.currentRoundId,
      playerId: identity.playerId,
      playerSecret: identity.playerSecret,
    });
  }, [identity, remoteRoom]);

  const value = useMemo<GameContextValue>(() => {
    const winner =
      state.judgeResult != null
        ? state.players.find((p) => p.id === state.judgeResult!.winnerPlayerId) ?? null
        : null;
    const loser = winner ? state.players.find((p) => p.id !== winner.id) ?? null : null;

    return {
      state,
      remoteRoom,
      remotePlayers: remoteRoom?.players ?? [],
      localPlayerId: identity?.playerId ?? null,
      localPlayer,
      isHost,
      isRemoteGame: Boolean(remoteRoom),
      loading,
      error,
      winner,
      loser,
      createRoom: async (displayName) => {
        const ok = await runRemote(async () => {
          const player = await ensureIdentity(displayName);
          return createGame(player.playerId);
        });
        if (ok) track('game_created');
        return ok;
      },
      joinRoom: async (roomCode, displayName) => {
        const ok = await runRemote(async () => {
          const player = await ensureIdentity(displayName);
          return joinGame(roomCode, player.playerId);
        });
        if (ok) track('game_joined', { roomCode });
        return ok;
      },
      toggleReady: async () => {
        if (!remoteRoom || !identity || !localPlayer) return;
        await runRemote(() => setReady(remoteRoom.gameId, identity.playerId, !localPlayer.ready));
      },
      startGame: async () => {
        if (remoteRoom && identity) {
          await runRemote(() => startRoundIfReady(remoteRoom.gameId, identity.playerId));
          return;
        }
        track('round_started', { round: 1 });
        dispatch({ type: 'START_GAME' });
      },
      beginDrawing: async () => {
        if (remoteRoom?.currentRoundId) {
          await runRemote(() => beginDrawingRound(remoteRoom.currentRoundId!));
          return;
        }
        dispatch({ type: 'BEGIN_DRAWING' });
      },
      localDrawingUri,
      submitDrawings: async (pngBase64) => {
        track('drawing_submitted', { round: state.roundNumber });
        if (remoteRoom?.currentRoundId && identity) {
          const gameId = remoteRoom.gameId;
          const roundId = remoteRoom.currentRoundId;
          const playerId = identity.playerId;
          if (!pngBase64) {
            setError('Could not read your drawing. Try submitting again.');
            return false;
          }
          const round = state.roundNumber;
          const ok = await runRemote(async () => {
            track('drawing_upload_started', { round });
            const startedAt = Date.now();
            let path: string;
            try {
              path = await uploadDrawingPng({ gameId, roundId, playerId }, pngBase64);
            } catch (err) {
              track('drawing_upload_failed', {
                round,
                reason: err instanceof Error ? err.message : 'unknown',
              });
              throw err;
            }
            track('drawing_upload_completed', { round, latencyMs: Date.now() - startedAt });
            // Marks the player submitted only now that the asset is available.
            await submitDrawing(gameId, roundId, playerId, path);
            // Apply a fresh snapshot directly so the "waiting for the other
            // player" state is correct even if Realtime is not publishing
            // round_submissions.
            return fetchRoomSnapshot(gameId);
          });
          if (ok) setLocalDrawingUri(`data:image/png;base64,${pngBase64}`);
          return ok;
        }
        dispatch({ type: 'SUBMIT_DRAWINGS' });
        return true;
      },
      completeRemoteJudging: async () => {
        // Idempotent + server-derived winner, so either client may call it.
        if (!remoteRoom?.currentRoundId) return;
        await runRemote(() => completeJudging(remoteRoom.gameId, remoteRoom.currentRoundId!));
      },
      markRemoteReveal: async () => {
        if (!remoteRoom?.currentRoundId) return;
        await runRemote(() => markReveal(remoteRoom.currentRoundId!));
      },
      reportJudgeResult: (result) => {
        track('judge_completed', { winner: result.winnerPlayerId });
        dispatch({ type: 'JUDGE_DONE', result });
      },
      reportCharacterizations: (map) => {
        track('characterization_completed');
        dispatch({ type: 'CHARACTERIZE_DONE', map });
      },
      reportAnimation: (animation) => dispatch({ type: 'ANIMATION_UPDATE', animation }),
      getWinnerAnimationRevealStatus,
      getRewardedAdCorrelation,
      getRewardedAdStatus,
      nextRound: async () => {
        const next = state.roundNumber + 1;
        track('next_round_pressed');
        if (remoteRoom && identity) {
          await runRemote(() => requestNextRound(remoteRoom.gameId, identity.playerId));
          return;
        }
        track('round_started', { round: next });
        if (next === 2) track('round_2_started');
        dispatch({ type: 'NEXT_ROUND' });
      },
      endGame: async () => {
        track('game_ended', { rounds: state.roundNumber });
        setLocalDrawingUri(null);
        if (remoteRoom) {
          await runRemote(() => endRemoteGame(remoteRoom.gameId));
          setRemoteRoom(null);
          return;
        }
        dispatch({ type: 'END_GAME' });
      },
      clearError: () => setError(null),
    };
  }, [ensureIdentity, error, getRewardedAdCorrelation, getRewardedAdStatus, getWinnerAnimationRevealStatus, identity, isHost, loading, localDrawingUri, localPlayer, remoteRoom, runRemote, state]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within a GameProvider');
  return ctx;
}
