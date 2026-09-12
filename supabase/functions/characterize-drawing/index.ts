// Milestone 4A: real Gemini characterization, server-side only.
//
// The client sends only identifiers (gameId, roundId, playerId, prompt) — it
// never uploads or receives raw image bytes for this call. This function:
//   1. loads the player's real drawing from the `drawings` bucket,
//   2. calls Gemini 3.1 Flash Image with the preservation prompt,
//   3. stores the result in the separate `characterized` bucket, and
//   4. records the path on round_submissions.
//
// GEMINI_API_KEY lives only here (a Supabase Edge Function secret) and is
// never returned to the client or logged.
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically by the
// platform into every Edge Function — only GEMINI_API_KEY needs to be set
// manually (see the README setup steps).
//
// CONCURRENCY (hardening pass): two devices can both call this for the same
// (round_id, player_id) at nearly the same instant. Generation is claimed via
// a single conditional UPDATE on round_submissions.characterization_status —
// see attemptClaim() below and the migration for why that one statement is
// atomic without an RPC or explicit row lock. A caller that loses the claim
// never calls Gemini; it polls the row instead.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { decodeBase64, encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

import { buildCharacterizationPrompt } from './prompt.ts';

const DRAWINGS_BUCKET = 'drawings';
const CHARACTERIZED_BUCKET = 'characterized';
const GEMINI_MODEL = 'gemini-3.1-flash-image';
// Comfortably under the client's 30s invoke timeout (RevealScreen.tsx) so a
// slow-but-alive Gemini call still has time to finish and be relayed back,
// rather than the client giving up right as this would have succeeded.
const GEMINI_TIMEOUT_MS = 25_000;
// A 'generating' row older than this is treated as abandoned (e.g. the owning
// function instance was killed by the platform mid-flight, bypassing its own
// try/catch) and becomes reclaimable. Comfortably above the ~25-28s worst
// case for one real attempt (Gemini's own timeout plus download/upload/DB
// overhead), per the suggested 45-60s range.
const STALE_GENERATING_MS = 50_000;
// How long a caller that lost the claim waits for the owner, before giving up
// and returning a clear in-progress error. Bounded well under the client's
// 30s invoke timeout so a timed-out poll still gets a real response relayed
// back instead of the client's own timeout firing first.
const POLL_INTERVAL_MS = 800;
const POLL_BUDGET_MS = 20_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  gameId?: string;
  roundId?: string;
  playerId?: string;
  prompt?: string;
}

/** A failure with an HTTP-status-and-error-code shape ready for jsonResponse. */
class StructuredError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Same deterministic layout as src/services/drawing/drawingAssets.ts on the client. */
function characterizedObjectPath(gameId: string, roundId: string, playerId: string): string {
  return `games/${gameId}/rounds/${roundId}/${playerId}.png`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(apiKey: string, promptText: string, imageBase64: string): Promise<string> {
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
                { inlineData: { mimeType: 'image/png', data: imageBase64 } },
              ],
            },
          ],
          // Cost-conscious, ~1K-class output; we do not request a specific
          // resolution/aspect ratio — the model conditions on the input image
          // and this keeps the request minimal. If the deployed API version
          // needs an explicit `generationConfig.imageConfig` (aspect ratio /
          // size) hint, verify the current field name in the Gemini docs and
          // add it here rather than guessing.
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
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
    for (const part of parts) {
      const inline = part.inlineData ?? part.inline_data;
      if (inline?.data) return inline.data as string;
    }
    throw new Error('gemini_no_image_returned');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Atomically claims the right to generate for (roundId, playerId). Exactly
 * one concurrent caller can succeed: this is a single conditional UPDATE, and
 * Postgres serializes concurrent UPDATEs to the same row — whichever commits
 * first "wins", and every other caller's WHERE clause is re-evaluated against
 * the now-committed row and matches zero rows. No RPC, no explicit lock, and
 * nothing new exposed to anonymous clients (this runs on the service-role
 * client only). Claimable when: never attempted ('pending'), a previous
 * attempt failed, or a 'generating' row has gone stale.
 */
// deno-lint-ignore no-explicit-any
async function attemptClaim(admin: any, roundId: string, playerId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const staleBeforeIso = new Date(Date.now() - STALE_GENERATING_MS).toISOString();

  const { data, error } = await admin
    .from('round_submissions')
    .update({ characterization_status: 'generating', characterization_started_at: nowIso, characterization_error: null })
    .eq('round_id', roundId)
    .eq('player_id', playerId)
    .is('characterized_path', null)
    .or(
      `characterization_status.eq.pending,characterization_status.eq.failed,and(characterization_status.eq.generating,characterization_started_at.lt.${staleBeforeIso})`,
    )
    .select('id')
    .maybeSingle();

  if (error) throw new StructuredError('db_error', error.message, 500);
  return Boolean(data);
}

type PollOutcome =
  | { outcome: 'completed'; path: string }
  | { outcome: 'failed'; message: string }
  | { outcome: 'timeout' };

/** Read-only wait for another request's in-flight generation. Never calls Gemini. */
// deno-lint-ignore no-explicit-any
async function pollForResult(admin: any, roundId: string, playerId: string): Promise<PollOutcome> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const { data, error } = await admin
      .from('round_submissions')
      .select('characterized_path, characterization_status, characterization_error')
      .eq('round_id', roundId)
      .eq('player_id', playerId)
      .maybeSingle();
    if (error) continue; // transient read error — retry within the same bounded window
    if (data?.characterized_path) return { outcome: 'completed', path: data.characterized_path };
    if (data?.characterization_status === 'failed') {
      return { outcome: 'failed', message: data.characterization_error ?? 'Generation failed.' };
    }
  }
  return { outcome: 'timeout' };
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

  const { gameId, roundId, playerId, prompt } = body;
  if (!gameId || !roundId || !playerId || !prompt) {
    return jsonResponse(
      { error: 'missing_params', message: 'gameId, roundId, playerId and prompt are all required.' },
      400,
    );
  }

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) {
    console.error('[characterize-drawing] GEMINI_API_KEY is not configured');
    return jsonResponse({ error: 'server_misconfigured', message: 'Characterization is not configured.' }, 500);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  console.log('[characterize-drawing] started', { gameId, roundId, playerId });

  // Sanity check, not a security boundary (RLS on these tables is
  // intentionally open for guest MVP) — catches a mismatched id pair early.
  const { data: round, error: roundError } = await admin
    .from('rounds')
    .select('id')
    .eq('id', roundId)
    .eq('game_id', gameId)
    .maybeSingle();
  if (roundError) return jsonResponse({ error: 'db_error', message: roundError.message }, 500);
  if (!round) return jsonResponse({ error: 'round_not_found', message: 'No such round in that game.' }, 404);

  const { data: submission, error: subError } = await admin
    .from('round_submissions')
    .select('drawing_path, characterized_path, characterization_status')
    .eq('round_id', roundId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (subError) return jsonResponse({ error: 'db_error', message: subError.message }, 500);
  if (!submission) {
    return jsonResponse({ error: 'submission_not_found', message: 'No submission for that player.' }, 404);
  }

  // Fast path: already done (a prior generation, by either device). No claim
  // attempt, no Gemini call.
  if (submission.characterized_path) {
    console.log('[characterize-drawing] characterization_existing', { gameId, roundId, playerId });
    return jsonResponse({ characterizedPath: submission.characterized_path, reused: true });
  }

  if (!submission.drawing_path) {
    return jsonResponse(
      { error: 'drawing_not_ready', message: 'The original drawing has not finished uploading yet.' },
      409,
    );
  }

  let claimed: boolean;
  try {
    claimed = await attemptClaim(admin, roundId, playerId);
  } catch (err) {
    const structured = err instanceof StructuredError ? err : new StructuredError('db_error', 'Claim failed.', 500);
    return jsonResponse({ error: structured.code, message: structured.message }, structured.status);
  }

  if (!claimed) {
    // Another request currently owns generation (and it isn't stale) — this
    // request must NOT call Gemini. Wait for the owner instead.
    console.log('[characterize-drawing] characterization_waiting', { gameId, roundId, playerId });
    const result = await pollForResult(admin, roundId, playerId);

    if (result.outcome === 'completed') {
      console.log('[characterize-drawing] characterization_reused', { gameId, roundId, playerId });
      return jsonResponse({ characterizedPath: result.path, reused: true });
    }
    if (result.outcome === 'failed') {
      console.log('[characterize-drawing] characterization_failed', { gameId, roundId, playerId, via: 'other-request' });
      return jsonResponse({ error: 'upstream_generation_failed', message: result.message }, 502);
    }
    console.log('[characterize-drawing] characterization_wait_timeout', { gameId, roundId, playerId });
    return jsonResponse(
      {
        error: 'characterization_in_progress',
        message: 'Another request is still generating this character. Try again shortly.',
      },
      409,
    );
  }

  console.log(
    submission.characterization_status === 'generating'
      ? '[characterize-drawing] characterization_stale_reclaimed'
      : '[characterize-drawing] characterization_claimed',
    { gameId, roundId, playerId },
  );

  try {
    const { data: drawingBlob, error: downloadError } = await admin.storage
      .from(DRAWINGS_BUCKET)
      .download(submission.drawing_path);
    if (downloadError || !drawingBlob) {
      throw new StructuredError('drawing_download_failed', downloadError?.message ?? 'unknown', 502);
    }

    const drawingBase64 = encodeBase64(new Uint8Array(await drawingBlob.arrayBuffer()));
    const promptText = buildCharacterizationPrompt(prompt);

    let generatedBase64: string;
    try {
      generatedBase64 = await callGemini(geminiKey, promptText, drawingBase64);
    } catch (err) {
      throw new StructuredError(
        'gemini_failed',
        err instanceof Error ? err.message : 'Gemini generation failed.',
        502,
      );
    }

    const outputPath = characterizedObjectPath(gameId, roundId, playerId);
    const { error: uploadError } = await admin.storage
      .from(CHARACTERIZED_BUCKET)
      .upload(outputPath, decodeBase64(generatedBase64), { contentType: 'image/png', upsert: true });
    if (uploadError) {
      throw new StructuredError('upload_failed', uploadError.message, 502);
    }

    const { error: updateError } = await admin
      .from('round_submissions')
      .update({
        characterized_path: outputPath,
        characterized_at: new Date().toISOString(),
        characterization_status: 'completed',
        characterization_error: null,
      })
      .eq('round_id', roundId)
      .eq('player_id', playerId);
    if (updateError) {
      // The generated image is already safely in Storage even though this
      // row update failed. Recorded as a failure below so the row isn't
      // stuck in 'generating' — the *next* call will re-run Gemini rather
      // than lose the round, which costs an extra generation but never hangs.
      throw new StructuredError('db_update_failed', updateError.message, 500);
    }

    console.log('[characterize-drawing] characterization_completed', {
      gameId,
      roundId,
      playerId,
      durationMs: Date.now() - startedAt,
    });
    return jsonResponse({ characterizedPath: outputPath, reused: false });
  } catch (err) {
    const structured =
      err instanceof StructuredError ? err : new StructuredError('unexpected_error', String(err), 500);

    console.error('[characterize-drawing] characterization_failed', {
      gameId,
      roundId,
      playerId,
      code: structured.code,
      message: structured.message,
    });

    // Never leave the row stuck in 'generating'. Best-effort: if even this
    // write fails, the STALE_GENERATING_MS window is the backstop that lets
    // a later request reclaim it anyway.
    const { error: failWriteError } = await admin
      .from('round_submissions')
      .update({ characterization_status: 'failed', characterization_error: structured.message.slice(0, 500) })
      .eq('round_id', roundId)
      .eq('player_id', playerId);
    if (failWriteError) {
      console.error('[characterize-drawing] failed to record failure state', {
        gameId,
        roundId,
        playerId,
        message: failWriteError.message,
      });
    }

    return jsonResponse({ error: structured.code, message: structured.message }, structured.status);
  }
});
