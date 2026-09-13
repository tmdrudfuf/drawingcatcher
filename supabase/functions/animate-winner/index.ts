import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MAX_SWEEP_LIMIT = 100;

type AnimateWinnerRequest =
  | {
      action: 'start';
      gameId: string;
      roundId: string;
      playerId: string;
      playerSecret: string;
    }
  | {
      action: 'status';
      jobId: string;
    }
  | {
      action: 'sweep';
      limit?: number;
    };

class StructuredError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ ...body, paidGenerationRequestsThisInvocation: 0 }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function resolveSupabaseSecretKey(): string {
  const keyName = Deno.env.get('ANIMATE_WINNER_SUPABASE_SECRET_KEY_NAME')?.trim();
  if (!keyName) {
    throw new StructuredError(
      'server_misconfigured',
      'ANIMATE_WINNER_SUPABASE_SECRET_KEY_NAME is not configured for winner animation.',
      500,
    );
  }

  const rawSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!rawSecretKeys) {
    throw new StructuredError('server_misconfigured', 'SUPABASE_SECRET_KEYS is unavailable.', 500);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSecretKeys);
  } catch {
    throw new StructuredError('server_misconfigured', 'SUPABASE_SECRET_KEYS is not valid JSON.', 500);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StructuredError('server_misconfigured', 'SUPABASE_SECRET_KEYS has an invalid structure.', 500);
  }

  const secretKeys = parsed as Record<string, unknown>;
  const selectedKey = secretKeys[keyName];
  if (
    !Object.prototype.hasOwnProperty.call(secretKeys, keyName) ||
    typeof selectedKey !== 'string' ||
    selectedKey !== selectedKey.trim() ||
    !selectedKey.startsWith('sb_secret_') ||
    selectedKey.length <= 'sb_secret_'.length
  ) {
    throw new StructuredError('server_misconfigured', 'The configured Supabase secret credential is invalid.', 500);
  }
  return selectedKey;
}

function createAdminClient(secretKey: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  if (!supabaseUrl) {
    throw new StructuredError('server_misconfigured', 'SUPABASE_URL is unavailable.', 500);
  }
  return createClient(supabaseUrl, secretKey);
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function isSecretKeyRequest(req: Request, secretKey: string): boolean {
  const apiKey = req.headers.get('apikey') ?? '';
  return Boolean(apiKey && safeEqual(apiKey, secretKey));
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new StructuredError('invalid_request', `${field} must be a non-empty string.`, 400);
  }
  return value.trim();
}

function parseRequest(value: unknown): AnimateWinnerRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StructuredError('invalid_request', 'Request body must be a JSON object.', 400);
  }
  const body = value as Record<string, unknown>;

  if (body.action === 'start') {
    return {
      action: 'start',
      gameId: requiredString(body, 'gameId'),
      roundId: requiredString(body, 'roundId'),
      playerId: requiredString(body, 'playerId'),
      playerSecret: requiredString(body, 'playerSecret'),
    };
  }
  if (body.action === 'status') {
    return { action: 'status', jobId: requiredString(body, 'jobId') };
  }
  if (body.action === 'sweep') {
    const limit = body.limit;
    if (
      limit !== undefined &&
      (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_SWEEP_LIMIT)
    ) {
      throw new StructuredError(
        'invalid_request',
        `limit must be an integer between 1 and ${MAX_SWEEP_LIMIT}.`,
        400,
      );
    }
    return { action: 'sweep', limit };
  }
  throw new StructuredError('invalid_action', "action must be 'start', 'status', or 'sweep'.", 400);
}

function notImplemented(action: AnimateWinnerRequest['action']): Response {
  return jsonResponse(
    {
      error: 'NOT_IMPLEMENTED',
      message: `animate-winner ${action} is not implemented yet.`,
      action,
    },
    501,
  );
}

/**
 * Proves the HTTP caller actually holds playerId's credential before any
 * server-side lookup or state change runs on its behalf (see the M4C step
 * 5A/5B migrations for the credential design). Delegates the actual secret
 * comparison to the verify_player_secret SECURITY DEFINER RPC so the hash
 * and comparison never leave the database — this function only ever sees a
 * boolean back.
 *
 * A `false` result (wrong secret) and an RPC/transport error are distinct
 * failure modes: a bad secret is a normal 401, but an infra failure must
 * never be silently treated as "not authorized" -- it is surfaced as a
 * db_error 500 instead, same convention as every other admin call in this
 * function.
 */
async function verifyPlayerOwnership(
  // deno-lint-ignore no-explicit-any
  admin: any,
  playerId: string,
  playerSecret: string,
): Promise<void> {
  const { data, error } = await admin.rpc('verify_player_secret', {
    p_player_id: playerId,
    p_secret: playerSecret,
  });
  if (error) throw new StructuredError('db_error', error.message, 500);
  if (data !== true) {
    throw new StructuredError('not_authorized', 'Player authorization failed.', 401);
  }
}

/**
 * Verifies a 'start' request against authoritative server-side data before any
 * future paid animation work is allowed. playerId is only an input to compare
 * against the round's real winner_player_id — it is never trusted as
 * authorization by itself.
 *
 * round_submissions has no game_id column, so the game/round match is proven
 * by chaining: rounds.id = roundId AND rounds.game_id = gameId (checked
 * first), then round_submissions.round_id = roundId. There is no separate
 * "is winner" flag on a submission — the winning submission is simply the
 * (roundId, playerId) submission once rounds.winner_player_id is confirmed
 * to equal playerId.
 */
async function verifyWinnerSubmission(
  // deno-lint-ignore no-explicit-any
  admin: any,
  gameId: string,
  roundId: string,
  playerId: string,
): Promise<{ roundSubmissionId: string }> {
  const { data: game, error: gameError } = await admin
    .from('games')
    .select('id')
    .eq('id', gameId)
    .maybeSingle();
  if (gameError) throw new StructuredError('db_error', gameError.message, 500);
  if (!game) throw new StructuredError('game_not_found', 'No such game.', 404);

  const { data: round, error: roundError } = await admin
    .from('rounds')
    .select('id, game_id, winner_player_id')
    .eq('id', roundId)
    .maybeSingle();
  if (roundError) throw new StructuredError('db_error', roundError.message, 500);
  if (!round) throw new StructuredError('round_not_found', 'No such round.', 404);
  if (round.game_id !== gameId) {
    throw new StructuredError('round_game_mismatch', 'The round does not belong to that game.', 409);
  }
  if (!round.winner_player_id) {
    throw new StructuredError('winner_not_ready', 'This round has not produced a winner yet.', 409);
  }
  if (round.winner_player_id !== playerId) {
    throw new StructuredError('not_winner', 'That player did not win this round.', 403);
  }

  const { data: submission, error: subError } = await admin
    .from('round_submissions')
    .select('id, characterization_status, characterized_path')
    .eq('round_id', roundId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (subError) throw new StructuredError('db_error', subError.message, 500);
  if (!submission) {
    throw new StructuredError('submission_not_found', 'No winning submission found for that round.', 404);
  }

  if (submission.characterization_status !== 'completed') {
    throw new StructuredError('characterization_not_ready', 'Characterization has not completed yet.', 409);
  }
  if (!submission.characterized_path) {
    throw new StructuredError(
      'characterized_asset_missing',
      'Characterization completed without a stored asset.',
      500,
    );
  }

  return { roundSubmissionId: submission.id };
}

interface AnimationJobRow {
  id: string;
  status: string;
  entitlement_source: string | null;
  paid_generation_requested_at: string | null;
}

/** Only the fields safe to return to a client: no storage paths, operation names, or raw rows. */
function jobResponsePayload(roundSubmissionId: string, job: AnimationJobRow): Record<string, unknown> {
  return {
    verified: true,
    jobId: job.id,
    jobStatus: job.status,
    roundSubmissionId,
    entitlementSource: job.entitlement_source,
    paidGenerationRequested: job.paid_generation_requested_at !== null,
  };
}

/** Fast, non-atomic reuse check — mirrors characterize-drawing's "already done" fast path. */
async function findExistingAnimationJob(
  // deno-lint-ignore no-explicit-any
  admin: any,
  roundSubmissionId: string,
): Promise<AnimationJobRow | null> {
  const { data, error } = await admin
    .from('animation_jobs')
    .select('id, status, entitlement_source, paid_generation_requested_at')
    .eq('round_submission_id', roundSubmissionId)
    .maybeSingle();
  if (error) throw new StructuredError('db_error', error.message, 500);
  return data;
}

/**
 * Atomically reuses an existing job or reserves one entitlement and creates
 * exactly one job, via the claim_animation_job RPC (see the M4C step-4
 * migration for the transaction/concurrency behavior). Never sets
 * paid_generation_requested_at and never calls Veo.
 */
async function claimAnimationJob(
  // deno-lint-ignore no-explicit-any
  admin: any,
  gameId: string,
  roundId: string,
  playerId: string,
  roundSubmissionId: string,
): Promise<AnimationJobRow> {
  const { data, error } = await admin.rpc('claim_animation_job', {
    p_game_id: gameId,
    p_round_id: roundId,
    p_player_id: playerId,
    p_round_submission_id: roundSubmissionId,
  });
  if (error) throw new StructuredError('db_error', error.message, 500);
  const job: AnimationJobRow | undefined = Array.isArray(data) ? data[0] : data;
  if (!job) {
    throw new StructuredError(
      'entitlement_required',
      'No available animation entitlement for this player.',
      402,
    );
  }
  return job;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse({ ok: true });
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'Only POST is supported.' }, 405);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
  }

  let request: AnimateWinnerRequest;
  try {
    request = parseRequest(rawBody);
  } catch (error) {
    const structured = error instanceof StructuredError
      ? error
      : new StructuredError('invalid_request', 'Request validation failed.', 400);
    if (!(error instanceof StructuredError)) console.error('[animate-winner] request validation failed');
    return jsonResponse({ error: structured.code, message: structured.message }, structured.status);
  }

  let supabaseSecretKey: string;
  let admin: ReturnType<typeof createAdminClient>;
  try {
    supabaseSecretKey = resolveSupabaseSecretKey();
    admin = createAdminClient(supabaseSecretKey);
  } catch (error) {
    const structured = error instanceof StructuredError
      ? error
      : new StructuredError('server_misconfigured', 'The Supabase admin client could not be created.', 500);
    console.error('[animate-winner] Supabase admin credential is not configured');
    return jsonResponse({ error: structured.code, message: structured.message }, structured.status);
  }

  if (request.action === 'sweep' && !isSecretKeyRequest(req, supabaseSecretKey)) {
    return jsonResponse({ error: 'forbidden', message: 'sweep requires secret-key authorization.' }, 403);
  }

  if (request.action === 'start') {
    try {
      await verifyPlayerOwnership(admin, request.playerId, request.playerSecret);
      console.log('[animate-winner] start_authorized');

      const { roundSubmissionId } = await verifyWinnerSubmission(
        admin,
        request.gameId,
        request.roundId,
        request.playerId,
      );
      console.log('[animate-winner] start_verified');

      const existingJob = await findExistingAnimationJob(admin, roundSubmissionId);
      if (existingJob) {
        console.log('[animate-winner] start_job_reused');
        return jsonResponse(jobResponsePayload(roundSubmissionId, existingJob), 200);
      }

      const claimedJob = await claimAnimationJob(
        admin,
        request.gameId,
        request.roundId,
        request.playerId,
        roundSubmissionId,
      );
      console.log('[animate-winner] start_job_claimed');
      return jsonResponse(jobResponsePayload(roundSubmissionId, claimedJob), 200);
    } catch (error) {
      const structured = error instanceof StructuredError
        ? error
        : new StructuredError('unexpected_error', 'Start failed unexpectedly.', 500);
      if (!(error instanceof StructuredError)) {
        console.error('[animate-winner] start failed unexpectedly');
      }
      console.log('[animate-winner] start_failed', { code: structured.code });
      return jsonResponse({ error: structured.code, message: structured.message }, structured.status);
    }
  }

  return notImplemented(request.action);
});
