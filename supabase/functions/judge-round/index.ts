// Milestone 4B: real Gemini judge, server-side only.
//
// The client sends only identifiers (gameId, roundId) — it never uploads or
// receives raw image bytes. This function:
//   1. loads the round (for its prompt) and both players (by slot),
//   2. confirms both players' real drawings have finished uploading,
//   3. calls Gemini once with the prompt + both images,
//   4. validates/normalizes the response (never trusts raw model output),
//   5. persists the result on `rounds`, and
//   6. advances the round to 'results' — this replaces the old
//      complete_fake_judging RPC for real-judged rounds; that RPC still
//      exists and is used by the client only as a failure-recovery fallback
//      (see GameProvider.completeRemoteJudging / JudgeScreen).
//
// GEMINI_API_KEY lives only here (a Supabase Edge Function secret) and is
// never returned to the client or logged. SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY are injected automatically by the platform.
//
// CONCURRENCY: both devices can call this for the same round at nearly the
// same instant. Judging is claimed via a single conditional UPDATE on
// rounds.judge_status — same pattern as characterize-drawing's
// attemptClaim(); see that file's comment for why one UPDATE statement is
// atomic without an RPC or explicit row lock. A caller that loses the claim
// never calls Gemini; it polls the row instead.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

import { buildJudgePrompt } from './prompt.ts';

const DRAWINGS_BUCKET = 'drawings';
// A general multimodal/text Gemini model, deliberately NOT the image-
// generation model characterize-drawing uses (gemini-3.1-flash-image) — this
// call only needs to read two images and return structured JSON, not
// generate one.
//
// gemini-2.5-flash is a generally-available multimodal model: it accepts
// image parts as inlineData, is served by :generateContent on the v1beta
// endpoint (same URL/header/body shape as characterize-drawing), and
// supports generationConfig.responseMimeType = 'application/json' for the
// structured verdict below. Flash tier keeps a per-round judge call cheap.
const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_TIMEOUT_MS = 25_000;
// Same reasoning as characterize-drawing's STALE_GENERATING_MS: comfortably
// above the ~25-28s worst case for one real judge attempt.
const STALE_JUDGING_MS = 50_000;
const POLL_INTERVAL_MS = 800;
const POLL_BUDGET_MS = 20_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  gameId?: string;
  roundId?: string;
}

class StructuredError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

interface NormalizedJudgeResult {
  player1Score: number;
  player2Score: number;
  /** Deterministic — never 'tie' by the time this is returned. See normalizeJudgeResponse(). */
  winnerSlot: 1 | 2;
  comment: string;
  player1Reason: string;
  player2Reason: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function safeString(value: unknown, fallback: string, maxLen = 300): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return (s.length > 0 ? s : fallback).slice(0, maxLen);
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

/**
 * Validates and normalizes Gemini's raw text response. Never trusts the
 * model directly: every field is parsed defensively and clamped/coerced.
 *
 * TIE HANDLING (explicit design choice): raw scores can be equal — that is
 * preserved as-is. But the persisted `winner_player_id` must always resolve
 * to exactly one player, because the existing Reveal/Results UI (unchanged,
 * out of scope to redesign) requires a single winner to animate and
 * announce. So an explicit "tie" verdict from Gemini, or two exactly equal
 * scores, is broken deterministically in favor of slot 1 — reusing the same
 * "slot 1 wins on a tie" convention the old fake judge already established
 * for this codebase, not a new arbitrary rule.
 */
function normalizeJudgeResponse(raw: string): NormalizedJudgeResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonText(raw));
  } catch {
    throw new Error('Gemini response was not valid JSON.');
  }

  const player1Score = clampScore(parsed.player1Score);
  const player2Score = clampScore(parsed.player2Score);
  const rawWinner = typeof parsed.winner === 'string' ? parsed.winner.toLowerCase() : '';

  let winnerSlot: 1 | 2;
  if (rawWinner === 'player1') winnerSlot = 1;
  else if (rawWinner === 'player2') winnerSlot = 2;
  else if (player1Score > player2Score) winnerSlot = 1;
  else if (player2Score > player1Score) winnerSlot = 2;
  else winnerSlot = 1; // explicit tie verdict, or exactly equal scores

  return {
    player1Score,
    player2Score,
    winnerSlot,
    comment: safeString(parsed.comment, 'Both drawings brought something fun to the prompt.'),
    player1Reason: safeString(parsed.player1Reason, ''),
    player2Reason: safeString(parsed.player2Reason, ''),
  };
}

async function callGeminiJudge(
  apiKey: string,
  promptText: string,
  image1Base64: string,
  image2Base64: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: promptText },
                { inlineData: { mimeType: 'image/png', data: image1Base64 } },
                { inlineData: { mimeType: 'image/png', data: image2Base64 } },
              ],
            },
          ],
          // Bias the model toward clean JSON; server-side parsing/validation
          // below is the actual safety net regardless (never trust raw prose).
          generationConfig: { responseMimeType: 'application/json' },
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`gemini_http_${res.status}: ${text.slice(0, 300)}`);
    }

    const json = await res.json();
    const parts: Array<Record<string, unknown>> = json?.candidates?.[0]?.content?.parts ?? [];
    const textPart = parts.find((p) => typeof p.text === 'string');
    if (!textPart) throw new Error('gemini_no_text_returned');
    return textPart.text as string;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Atomically claims the right to judge this round. Same guarantee as
 * characterize-drawing's attemptClaim: a single conditional UPDATE, and
 * Postgres serializes concurrent UPDATEs to the same row, so exactly one
 * concurrent caller can succeed. Claimable when: never attempted ('pending'),
 * a previous attempt failed, or a 'judging' row has gone stale. Also
 * requires rounds.status = 'judging' — judging only makes sense for a round
 * actually in that phase.
 */
// deno-lint-ignore no-explicit-any
async function attemptJudgeClaim(admin: any, gameId: string, roundId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const staleBeforeIso = new Date(Date.now() - STALE_JUDGING_MS).toISOString();

  const { data, error } = await admin
    .from('rounds')
    .update({ judge_status: 'judging', judge_started_at: nowIso, judge_error: null })
    .eq('id', roundId)
    .eq('game_id', gameId)
    .eq('status', 'judging')
    .or(
      `judge_status.eq.pending,judge_status.eq.failed,and(judge_status.eq.judging,judge_started_at.lt.${staleBeforeIso})`,
    )
    .select('id')
    .maybeSingle();

  if (error) throw new StructuredError('db_error', error.message, 500);
  return Boolean(data);
}

interface JudgeRow {
  judge_status: string;
  judge_player1_score: number | null;
  judge_player2_score: number | null;
  winner_player_id: string | null;
  judge_comment: string | null;
  judge_player1_reason: string | null;
  judge_player2_reason: string | null;
  judge_error: string | null;
}

type JudgePollOutcome = { outcome: 'completed'; round: JudgeRow } | { outcome: 'failed'; message: string } | { outcome: 'timeout' };

/** Read-only wait for another request's in-flight judging. Never calls Gemini. */
// deno-lint-ignore no-explicit-any
async function pollForJudgeResult(admin: any, gameId: string, roundId: string): Promise<JudgePollOutcome> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const { data, error } = await admin
      .from('rounds')
      .select(
        'judge_status, judge_player1_score, judge_player2_score, winner_player_id, judge_comment, judge_player1_reason, judge_player2_reason, judge_error',
      )
      .eq('id', roundId)
      .eq('game_id', gameId)
      .maybeSingle();
    if (error) continue; // transient read error — retry within the same bounded window
    if (data?.judge_status === 'completed') return { outcome: 'completed', round: data as JudgeRow };
    if (data?.judge_status === 'failed') {
      return { outcome: 'failed', message: data.judge_error ?? 'Judging failed.' };
    }
  }
  return { outcome: 'timeout' };
}

function judgePayload(round: JudgeRow, player1Id: string, player2Id: string, reused: boolean) {
  return {
    player1Score: round.judge_player1_score,
    player2Score: round.judge_player2_score,
    winnerPlayerId: round.winner_player_id,
    comment: round.judge_comment,
    player1Reason: round.judge_player1_reason,
    player2Reason: round.judge_player2_reason,
    player1PlayerId: player1Id,
    player2PlayerId: player2Id,
    reused,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const startedAt = Date.now();
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json', message: 'Request body must be JSON.' }, 400);
  }

  const { gameId, roundId } = body;
  if (!gameId || !roundId) {
    return jsonResponse({ error: 'missing_params', message: 'gameId and roundId are required.' }, 400);
  }

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) {
    console.error('[judge-round] GEMINI_API_KEY is not configured');
    return jsonResponse({ error: 'server_misconfigured', message: 'Judging is not configured.' }, 500);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  console.log('[judge-round] started', { gameId, roundId });

  const { data: round, error: roundError } = await admin
    .from('rounds')
    .select(
      'id, prompt, status, judge_status, judge_player1_score, judge_player2_score, winner_player_id, judge_comment, judge_player1_reason, judge_player2_reason, judge_error',
    )
    .eq('id', roundId)
    .eq('game_id', gameId)
    .maybeSingle();
  if (roundError) return jsonResponse({ error: 'db_error', message: roundError.message }, 500);
  if (!round) return jsonResponse({ error: 'round_not_found', message: 'No such round in that game.' }, 404);

  const { data: playerRows, error: playersError } = await admin
    .from('game_players')
    .select('slot, player_id')
    .eq('game_id', gameId)
    .order('slot', { ascending: true });
  if (playersError) return jsonResponse({ error: 'db_error', message: playersError.message }, 500);
  if (!playerRows || playerRows.length !== 2) {
    return jsonResponse({ error: 'players_not_ready', message: 'Both players must have joined.' }, 409);
  }
  const [p1, p2] = playerRows as Array<{ slot: number; player_id: string }>;

  // Fast path: already judged (either device, or a retry). No claim, no Gemini call.
  if (round.judge_status === 'completed' && round.judge_player1_score != null) {
    console.log('[judge-round] judge_reused', { gameId, roundId, via: 'existing' });
    return jsonResponse(judgePayload(round as JudgeRow, p1.player_id, p2.player_id, true));
  }

  const { data: submissionRows, error: subError } = await admin
    .from('round_submissions')
    .select('player_id, drawing_path')
    .eq('round_id', roundId);
  if (subError) return jsonResponse({ error: 'db_error', message: subError.message }, 500);

  const path1 = submissionRows?.find((r: { player_id: string }) => r.player_id === p1.player_id)?.drawing_path;
  const path2 = submissionRows?.find((r: { player_id: string }) => r.player_id === p2.player_id)?.drawing_path;
  if (!path1 || !path2) {
    return jsonResponse(
      { error: 'drawings_not_ready', message: 'Both drawings must be uploaded before judging.' },
      409,
    );
  }

  let claimed: boolean;
  try {
    claimed = await attemptJudgeClaim(admin, gameId, roundId);
  } catch (err) {
    const structured = err instanceof StructuredError ? err : new StructuredError('db_error', 'Claim failed.', 500);
    return jsonResponse({ error: structured.code, message: structured.message }, structured.status);
  }

  if (!claimed) {
    // Another request currently owns judging (and it isn't stale) — this
    // request must NOT call Gemini. Wait for the owner instead.
    console.log('[judge-round] judge_waiting', { gameId, roundId });
    const result = await pollForJudgeResult(admin, gameId, roundId);

    if (result.outcome === 'completed') {
      console.log('[judge-round] judge_reused', { gameId, roundId, via: 'poll' });
      return jsonResponse(judgePayload(result.round, p1.player_id, p2.player_id, true));
    }
    if (result.outcome === 'failed') {
      console.log('[judge-round] judge_failed', { gameId, roundId, via: 'other-request' });
      return jsonResponse({ error: 'upstream_generation_failed', message: result.message }, 502);
    }
    console.log('[judge-round] judge_wait_timeout', { gameId, roundId });
    return jsonResponse(
      { error: 'judging_in_progress', message: 'Another request is still judging this round. Try again shortly.' },
      409,
    );
  }

  console.log(
    round.judge_status === 'judging' ? '[judge-round] judge_stale_reclaimed' : '[judge-round] judge_claimed',
    { gameId, roundId },
  );

  try {
    const [drawing1, drawing2] = await Promise.all([
      admin.storage.from(DRAWINGS_BUCKET).download(path1),
      admin.storage.from(DRAWINGS_BUCKET).download(path2),
    ]);
    if (drawing1.error || !drawing1.data) {
      throw new StructuredError('drawing_download_failed', drawing1.error?.message ?? 'player1 drawing', 502);
    }
    if (drawing2.error || !drawing2.data) {
      throw new StructuredError('drawing_download_failed', drawing2.error?.message ?? 'player2 drawing', 502);
    }

    const image1Base64 = encodeBase64(new Uint8Array(await drawing1.data.arrayBuffer()));
    const image2Base64 = encodeBase64(new Uint8Array(await drawing2.data.arrayBuffer()));
    const promptText = buildJudgePrompt(round.prompt);

    let rawText: string;
    try {
      rawText = await callGeminiJudge(geminiKey, promptText, image1Base64, image2Base64);
    } catch (err) {
      throw new StructuredError(
        'gemini_failed',
        err instanceof Error ? err.message : 'Gemini judging failed.',
        502,
      );
    }

    let normalized: NormalizedJudgeResult;
    try {
      normalized = normalizeJudgeResponse(rawText);
    } catch (err) {
      throw new StructuredError(
        'judge_invalid_response',
        err instanceof Error ? err.message : 'Could not parse Gemini judge response.',
        502,
      );
    }

    const winnerPlayerId = normalized.winnerSlot === 1 ? p1.player_id : p2.player_id;
    const nowIso = new Date().toISOString();

    const { error: updateError } = await admin
      .from('rounds')
      .update({
        judge_status: 'completed',
        judge_player1_score: normalized.player1Score,
        judge_player2_score: normalized.player2Score,
        judge_comment: normalized.comment,
        judge_player1_reason: normalized.player1Reason,
        judge_player2_reason: normalized.player2Reason,
        judged_at: nowIso,
        judge_error: null,
        // Advances the round exactly like the old complete_fake_judging RPC.
        status: 'results',
        winner_player_id: winnerPlayerId,
        completed_at: nowIso,
      })
      .eq('id', roundId)
      .eq('game_id', gameId);
    if (updateError) {
      throw new StructuredError('db_update_failed', updateError.message, 500);
    }

    console.log('[judge-round] judge_completed', { gameId, roundId, durationMs: Date.now() - startedAt });
    return jsonResponse(
      judgePayload(
        {
          judge_status: 'completed',
          judge_player1_score: normalized.player1Score,
          judge_player2_score: normalized.player2Score,
          winner_player_id: winnerPlayerId,
          judge_comment: normalized.comment,
          judge_player1_reason: normalized.player1Reason,
          judge_player2_reason: normalized.player2Reason,
          judge_error: null,
        },
        p1.player_id,
        p2.player_id,
        false,
      ),
    );
  } catch (err) {
    const structured =
      err instanceof StructuredError ? err : new StructuredError('unexpected_error', String(err), 500);

    console.error('[judge-round] judge_failed', {
      gameId,
      roundId,
      code: structured.code,
      message: structured.message,
    });

    // Never leave the round stuck in 'judging'. rounds.status is deliberately
    // NOT advanced here — the client's fallback path (the existing
    // complete_fake_judging RPC) is what advances the round for a real-judge
    // failure, so both devices are never stuck. STALE_JUDGING_MS is the
    // backstop if even this write doesn't land.
    const { error: failWriteError } = await admin
      .from('rounds')
      .update({ judge_status: 'failed', judge_error: structured.message.slice(0, 500) })
      .eq('id', roundId)
      .eq('game_id', gameId);
    if (failWriteError) {
      console.error('[judge-round] failed to record failure state', { gameId, roundId, message: failWriteError.message });
    }

    return jsonResponse({ error: structured.code, message: structured.message }, structured.status);
  }
});
