import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

const CHARACTERIZED_BUCKET = 'characterized';
const ANIMATIONS_BUCKET = 'animations';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const VEO_MODEL = 'veo-3.1-generate-preview';
const VEO_CREATE_TIMEOUT_MS = 30_000;
const VEO_POLL_TIMEOUT_MS = 20_000;
const VEO_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_GENERATED_VIDEO_BYTES = 100 * 1024 * 1024;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const DEFAULT_SWEEP_LIMIT = 5;
const MAX_SWEEP_LIMIT = 10;

const ANIMATION_PROMPT = `Animate this exact character with one small playful, funny motion.

Preserve the character's identity, silhouette, unusual proportions, colors,
asymmetry, facial features, limb count, and every recognizable weird detail.

Do not redesign, beautify, normalize, replace, or reinterpret the character.
Keep the composition and background simple and stable. Use only one small
movement such as a wobble, waddle, bounce, blink, tail wag, stumble, or
surprised reaction.

No cuts. No dramatic camera movement. No new characters. No extra limbs.
No text.`;

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
      gameId: string;
      roundId: string;
      playerId: string;
      playerSecret: string;
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

interface ProviderErrorSummary {
  code: number | string | null;
  status: string | null;
  message: string;
}

type VeoCreateResult =
  | {
      outcome: 'accepted';
      httpStatus: 200;
      operationName: string;
    }
  | {
      outcome: 'rejected';
      httpStatus: number;
      providerError: ProviderErrorSummary;
    }
  | {
      outcome: 'ambiguous';
      httpStatus: number | null;
      errorCode: string;
      message: string;
    };

type VeoPollResult =
  | { outcome: 'pending'; httpStatus: 200 }
  | { outcome: 'completed'; httpStatus: 200; videoUri: string }
  | { outcome: 'failed'; httpStatus: 200; providerError: ProviderErrorSummary }
  | {
      outcome: 'recoverable_error';
      httpStatus: number | null;
      errorCode: string;
      message: string;
    };

interface VideoAsset {
  bytes: Uint8Array;
  contentType: string;
  contentLength: number;
}

type CompletionResult =
  | {
      outcome: 'state';
      job: AnimationJobRow;
      providerPolled: boolean;
      storageDisposition?: 'existing' | 'uploaded' | 'race_recovered';
    }
  | {
      outcome: 'recoverable_error';
      job: AnimationJobRow;
      errorCode: string;
      message: string;
      providerPolled: boolean;
      httpStatus?: number | null;
    };

interface CompletionDependencies {
  pollOperation: (apiKey: string, operationName: string) => Promise<VeoPollResult>;
  downloadVideo: (apiKey: string, videoUri: string) => Promise<VideoAsset>;
  readStoredVideo: (videoPath: string) => Promise<VideoAsset | null>;
  storeVideo: (videoPath: string, video: VideoAsset) => Promise<'uploaded' | 'race_recovered'>;
  markPolled: (jobId: string) => Promise<AnimationJobRow>;
  markDownloading: (jobId: string) => Promise<AnimationJobRow>;
  markProviderFailed: (jobId: string, providerError: ProviderErrorSummary) => Promise<AnimationJobRow>;
  finalize: (jobId: string, videoPath: string, video: VideoAsset) => Promise<AnimationJobRow>;
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  paidGenerationRequestsThisInvocation = 0,
): Response {
  return new Response(JSON.stringify({ ...body, paidGenerationRequestsThisInvocation }), {
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

function providerErrorSummary(value: unknown, fallback: string): ProviderErrorSummary {
  const candidate =
    value && typeof value === 'object' && 'error' in value
      ? (value as { error?: unknown }).error
      : value;
  if (!candidate || typeof candidate !== 'object') {
    return { code: null, status: null, message: fallback };
  }
  const error = candidate as Record<string, unknown>;
  return {
    code: typeof error.code === 'number' || typeof error.code === 'string' ? error.code : null,
    status: typeof error.status === 'string' ? error.status.slice(0, 200) : null,
    message: typeof error.message === 'string' ? error.message.slice(0, 1000) : fallback,
  };
}

function isSafeOperationName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 500 &&
    value.includes('operations/') &&
    !value.includes('..') &&
    !value.includes('://') &&
    !/[?#\\]/.test(value) &&
    /^[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(value)
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseProviderJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function createVeoAnimation(
  apiKey: string,
  prompt: string,
  imageBase64: string,
): Promise<VeoCreateResult> {
  const endpoint = `${GEMINI_BASE_URL}/models/${VEO_MODEL}:predictLongRunning`;
  const requestBody = {
    instances: [
      {
        prompt,
        image: { bytesBase64Encoded: imageBase64, mimeType: 'image/png' },
      },
    ],
    parameters: {
      aspectRatio: '9:16',
      durationSeconds: 4,
      resolution: '720p',
      personGeneration: 'allow_adult',
    },
  };

  let response: Response;
  try {
    // This is the only paid create request. Raw fetch performs no retry, and
    // no catch/fallback path calls this endpoint again.
    response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(requestBody),
      },
      VEO_CREATE_TIMEOUT_MS,
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return {
      outcome: 'ambiguous',
      httpStatus: null,
      errorCode: timedOut ? 'veo_create_timeout_ambiguous' : 'veo_create_transport_ambiguous',
      message: timedOut
        ? 'The Veo creation response timed out; acceptance is unknown and the request must not be retried.'
        : 'The Veo creation transport failed after dispatch; acceptance is unknown and the request must not be retried.',
    };
  }

  let payload: unknown;
  try {
    payload = await parseProviderJson(response);
  } catch {
    return {
      outcome: 'ambiguous',
      httpStatus: response.status,
      errorCode: 'veo_response_read_ambiguous',
      message: 'The Veo creation response could not be read; acceptance is unknown and the request must not be retried.',
    };
  }
  if (response.status === 408 || response.status >= 500) {
    return {
      outcome: 'ambiguous',
      httpStatus: response.status,
      errorCode: 'veo_create_http_ambiguous',
      message: `Veo returned HTTP ${response.status}; acceptance is uncertain and the request must not be retried.`,
    };
  }
  if (response.status !== 200) {
    return {
      outcome: 'rejected',
      httpStatus: response.status,
      providerError: providerErrorSummary(payload, `Veo returned HTTP ${response.status}.`),
    };
  }

  const operationName =
    payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).name === 'string'
      ? ((payload as Record<string, unknown>).name as string)
      : null;
  if (!operationName || !isSafeOperationName(operationName)) {
    return {
      outcome: 'ambiguous',
      httpStatus: response.status,
      errorCode: 'veo_operation_name_missing',
      message: 'Veo returned HTTP 200 without a safe operation name; the request must not be retried.',
    };
  }

  return { outcome: 'accepted', httpStatus: 200, operationName };
}

function findVideoUri(operation: unknown): string | null {
  if (!operation || typeof operation !== 'object') return null;
  const response = (operation as Record<string, unknown>).response as Record<string, unknown> | undefined;
  const generateVideoResponse = response?.generateVideoResponse as Record<string, unknown> | undefined;
  const samples = generateVideoResponse?.generatedSamples;
  if (!Array.isArray(samples) || !samples.length) return null;
  const video = (samples[0] as Record<string, unknown> | undefined)?.video as Record<string, unknown> | undefined;
  return typeof video?.uri === 'string' ? video.uri : null;
}

function isSafeVideoUri(value: string): boolean {
  if (!value || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.host === 'generativelanguage.googleapis.com' &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

async function pollVeoOperation(
  apiKey: string,
  operationName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VeoPollResult> {
  if (!isSafeOperationName(operationName)) {
    return {
      outcome: 'recoverable_error',
      httpStatus: null,
      errorCode: 'veo_operation_name_invalid',
      message: 'The persisted Veo operation name is invalid.',
    };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${GEMINI_BASE_URL}/${operationName}`,
      { method: 'GET', headers: { 'x-goog-api-key': apiKey } },
      VEO_POLL_TIMEOUT_MS,
      fetchImpl,
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return {
      outcome: 'recoverable_error',
      httpStatus: null,
      errorCode: timedOut ? 'veo_poll_timeout' : 'veo_poll_transport_failed',
      message: timedOut ? 'The Veo operation poll timed out.' : 'The Veo operation poll could not be completed.',
    };
  }

  let payload: unknown;
  try {
    payload = await parseProviderJson(response);
  } catch {
    return {
      outcome: 'recoverable_error',
      httpStatus: response.status,
      errorCode: 'veo_poll_response_unreadable',
      message: 'The Veo operation response could not be read.',
    };
  }
  if (!response.ok) {
    return {
      outcome: 'recoverable_error',
      httpStatus: response.status,
      errorCode: 'veo_poll_http_failed',
      message: `The Veo operation poll returned HTTP ${response.status}.`,
    };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      outcome: 'recoverable_error',
      httpStatus: 200,
      errorCode: 'veo_poll_response_invalid',
      message: 'The Veo operation response was invalid.',
    };
  }
  const record = payload as Record<string, unknown>;
  if (record.done !== true) return { outcome: 'pending', httpStatus: 200 };
  if (record.error) {
    return {
      outcome: 'failed',
      httpStatus: 200,
      providerError: providerErrorSummary(record.error, 'The Veo operation completed with an error.'),
    };
  }

  const videoUri = findVideoUri(payload);
  if (!videoUri || !isSafeVideoUri(videoUri)) {
    return {
      outcome: 'recoverable_error',
      httpStatus: 200,
      errorCode: 'veo_completed_video_reference_missing',
      message: 'The completed Veo operation did not contain a safe video reference.',
    };
  }
  return { outcome: 'completed', httpStatus: 200, videoUri };
}

function normalizedVideoContentType(value: string | null): string | null {
  if (!value) return null;
  const contentType = value.split(';', 1)[0].trim().toLowerCase();
  return contentType.startsWith('video/') ? contentType : null;
}

function validateVideoBytes(bytes: Uint8Array, contentTypeHeader: string | null): VideoAsset {
  const contentType = normalizedVideoContentType(contentTypeHeader);
  if (!contentType) {
    throw new StructuredError('generated_video_invalid_type', 'The generated asset is not a video.', 502);
  }
  if (contentType !== 'video/mp4') {
    throw new StructuredError('generated_video_unsupported_type', 'The generated video is not an MP4.', 502);
  }
  if (!bytes.length) {
    throw new StructuredError('generated_video_empty', 'The generated video is empty.', 502);
  }
  if (bytes.length > MAX_GENERATED_VIDEO_BYTES) {
    throw new StructuredError('generated_video_too_large', 'The generated video exceeds the size limit.', 502);
  }
  return { bytes, contentType, contentLength: bytes.length };
}

async function downloadGeneratedVideo(
  apiKey: string,
  videoUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VideoAsset> {
  if (!isSafeVideoUri(videoUri)) {
    throw new StructuredError('generated_video_reference_invalid', 'The generated video reference is invalid.', 502);
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      videoUri,
      { method: 'GET', headers: { 'x-goog-api-key': apiKey }, redirect: 'error' },
      VEO_DOWNLOAD_TIMEOUT_MS,
      fetchImpl,
    );
  } catch {
    throw new StructuredError('generated_video_download_failed', 'The generated video could not be downloaded.', 502);
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    throw new StructuredError(
      'generated_video_download_http_failed',
      `The generated video download returned HTTP ${response.status}.`,
      502,
    );
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GENERATED_VIDEO_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new StructuredError('generated_video_too_large', 'The generated video exceeds the size limit.', 502);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new StructuredError('generated_video_read_failed', 'The generated video could not be read.', 502);
  }
  return validateVideoBytes(bytes, response.headers.get('content-type'));
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
    return {
      action: 'status',
      jobId: requiredString(body, 'jobId'),
      gameId: requiredString(body, 'gameId'),
      roundId: requiredString(body, 'roundId'),
      playerId: requiredString(body, 'playerId'),
      playerSecret: requiredString(body, 'playerSecret'),
    };
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
): Promise<{ roundSubmissionId: string; characterizedPath: string }> {
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

  return { roundSubmissionId: submission.id, characterizedPath: submission.characterized_path };
}

interface AnimationJobRow {
  id: string;
  game_id: string;
  round_id: string;
  player_id: string;
  round_submission_id: string;
  status: string;
  entitlement_source: string | null;
  entitlement_id: string | null;
  paid_generation_requested_at: string | null;
  veo_operation_name: string | null;
  video_path: string | null;
  video_content_type: string | null;
  video_content_length: number | null;
  completed_at: string | null;
}

const ANIMATION_JOB_SELECT = [
  'id',
  'game_id',
  'round_id',
  'player_id',
  'round_submission_id',
  'status',
  'entitlement_source',
  'entitlement_id',
  'paid_generation_requested_at',
  'veo_operation_name',
  'video_path',
  'video_content_type',
  'video_content_length',
  'completed_at',
].join(', ');

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
    .select(ANIMATION_JOB_SELECT)
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

async function findAnimationJobById(
  // deno-lint-ignore no-explicit-any
  admin: any,
  jobId: string,
): Promise<AnimationJobRow> {
  const { data, error } = await admin
    .from('animation_jobs')
    .select(ANIMATION_JOB_SELECT)
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new StructuredError('db_error', error.message, 500);
  if (!data) throw new StructuredError('animation_job_not_found', 'Animation job no longer exists.', 404);
  return data;
}

async function claimPaidGenerationRequest(
  // deno-lint-ignore no-explicit-any
  admin: any,
  jobId: string,
): Promise<AnimationJobRow | null> {
  const { data, error } = await admin.rpc('claim_paid_generation_request', { p_job_id: jobId });
  if (error) {
    if (error.code === 'P0001' && error.message.includes('paid_generation_already_requested')) {
      return null;
    }
    if (error.code === 'P0002' && error.message.includes('animation_job_not_found')) {
      throw new StructuredError('animation_job_not_found', 'Animation job no longer exists.', 404);
    }
    throw new StructuredError('db_error', error.message, 500);
  }
  const job: AnimationJobRow | undefined = Array.isArray(data) ? data[0] : data;
  if (!job?.paid_generation_requested_at) {
    throw new StructuredError('db_error', 'Paid-generation claim returned an invalid job.', 500);
  }
  return job;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

async function loadCharacterizedPng(
  // deno-lint-ignore no-explicit-any
  admin: any,
  characterizedPath: string,
): Promise<string> {
  const { data: imageBlob, error } = await admin.storage.from(CHARACTERIZED_BUCKET).download(characterizedPath);
  if (error || !imageBlob) {
    throw new StructuredError(
      'source_image_download_failed',
      'The characterized source image could not be downloaded after the paid claim.',
      502,
    );
  }
  if (imageBlob.type && imageBlob.type !== 'image/png' && imageBlob.type !== 'application/octet-stream') {
    throw new StructuredError(
      'source_image_invalid_type',
      'The characterized source image is not a PNG.',
      422,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await imageBlob.arrayBuffer());
  } catch {
    throw new StructuredError(
      'source_image_read_failed',
      'The characterized source image could not be read after the paid claim.',
      502,
    );
  }
  if (!bytes.length) {
    throw new StructuredError('source_image_empty', 'The characterized source image is empty.', 422);
  }
  if (!hasPngSignature(bytes)) {
    throw new StructuredError(
      'source_image_invalid_png',
      'The characterized source image does not contain valid PNG bytes.',
      422,
    );
  }
  return encodeBase64(bytes);
}

async function updateAnimationJob(
  // deno-lint-ignore no-explicit-any
  admin: any,
  jobId: string,
  updates: Record<string, unknown>,
): Promise<AnimationJobRow> {
  const { data, error } = await admin
    .from('animation_jobs')
    .update(updates)
    .eq('id', jobId)
    .select(ANIMATION_JOB_SELECT)
    .single();
  if (error || !data) {
    throw new StructuredError('db_error', 'Animation job state could not be persisted.', 500);
  }
  return data;
}

function animationVideoPath(job: AnimationJobRow): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(job.game_id) || !uuid.test(job.round_id) || !uuid.test(job.round_submission_id)) {
    throw new StructuredError('animation_job_identity_invalid', 'Animation job identity is invalid.', 500);
  }
  return 'games/' + job.game_id + '/rounds/' + job.round_id + '/' + job.round_submission_id + '.mp4';
}

function storageErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  const value = record.statusCode ?? record.status;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

function storageErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const value = (error as Record<string, unknown>).message;
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function isStorageNotFound(error: unknown): boolean {
  const status = storageErrorStatus(error);
  const message = storageErrorMessage(error);
  return status === 404 || message.includes('not found') || message.includes('does not exist');
}

function isStorageConflict(error: unknown): boolean {
  const status = storageErrorStatus(error);
  const message = storageErrorMessage(error);
  return status === 409 || message.includes('already exists') || message.includes('duplicate');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = bytes.slice().buffer;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function videosMatch(left: VideoAsset, right: VideoAsset): Promise<boolean> {
  if (left.contentType !== right.contentType || left.contentLength !== right.contentLength) return false;
  return safeEqual(await sha256Hex(left.bytes), await sha256Hex(right.bytes));
}

async function readStoredVideo(
  // deno-lint-ignore no-explicit-any
  admin: any,
  videoPath: string,
): Promise<VideoAsset | null> {
  const { data, error } = await admin.storage.from(ANIMATIONS_BUCKET).download(videoPath);
  if (error) {
    if (isStorageNotFound(error)) return null;
    throw new StructuredError('animation_storage_read_failed', 'The stored animation could not be inspected.', 502);
  }
  if (!data) {
    throw new StructuredError('animation_storage_read_failed', 'The stored animation could not be inspected.', 502);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await data.arrayBuffer());
  } catch {
    throw new StructuredError('animation_storage_read_failed', 'The stored animation could not be read.', 502);
  }
  return validateVideoBytes(bytes, data.type);
}

async function storeVideoWithoutOverwrite(
  // deno-lint-ignore no-explicit-any
  admin: any,
  videoPath: string,
  video: VideoAsset,
): Promise<'uploaded' | 'race_recovered'> {
  const { error } = await admin.storage.from(ANIMATIONS_BUCKET).upload(videoPath, video.bytes, {
    contentType: video.contentType,
    upsert: false,
  });
  if (!error) return 'uploaded';
  if (!isStorageConflict(error)) {
    throw new StructuredError('animation_storage_upload_failed', 'The animation could not be stored.', 502);
  }

  const existing = await readStoredVideo(admin, videoPath);
  if (!existing || !(await videosMatch(existing, video))) {
    throw new StructuredError(
      'animation_storage_conflict',
      'A different object already exists at the animation storage path.',
      409,
    );
  }
  return 'race_recovered';
}

async function markAnimationJobPolled(
  // deno-lint-ignore no-explicit-any
  admin: any,
  jobId: string,
): Promise<AnimationJobRow> {
  return await updateAnimationJob(admin, jobId, { last_polled_at: new Date().toISOString() });
}

async function markAnimationJobDownloading(
  // deno-lint-ignore no-explicit-any
  admin: any,
  jobId: string,
): Promise<AnimationJobRow> {
  const { data, error } = await admin
    .from('animation_jobs')
    .update({ status: 'downloading', last_polled_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'operation_pending')
    .select(ANIMATION_JOB_SELECT)
    .maybeSingle();
  if (error) throw new StructuredError('db_error', 'Animation download state could not be persisted.', 500);
  return data ?? await findAnimationJobById(admin, jobId);
}

async function markAnimationJobProviderFailed(
  // deno-lint-ignore no-explicit-any
  admin: any,
  jobId: string,
  providerError: ProviderErrorSummary,
): Promise<AnimationJobRow> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('animation_jobs')
    .update({
      status: 'failed',
      last_polled_at: now,
      provider_error_code: providerError.code === null ? null : String(providerError.code).slice(0, 200),
      provider_error_status: providerError.status,
      error_code: 'veo_operation_failed',
      error_message: providerError.message,
      failed_at: now,
    })
    .eq('id', jobId)
    .in('status', ['operation_pending', 'downloading'])
    .select(ANIMATION_JOB_SELECT)
    .maybeSingle();
  if (error) throw new StructuredError('db_error', 'Animation failure state could not be persisted.', 500);
  return data ?? await findAnimationJobById(admin, jobId);
}

async function finalizeAnimationJob(
  // deno-lint-ignore no-explicit-any
  admin: any,
  jobId: string,
  videoPath: string,
  video: VideoAsset,
): Promise<AnimationJobRow> {
  const { data, error } = await admin.rpc('finalize_animation_job', {
    p_job_id: jobId,
    p_video_path: videoPath,
    p_video_content_type: video.contentType,
    p_video_content_length: video.contentLength,
  });
  if (error) {
    if (error.code === 'P0001' && error.message.includes('entitlement_finalization_conflict')) {
      throw new StructuredError('entitlement_finalization_conflict', 'Animation entitlement state is inconsistent.', 409);
    }
    if (error.code === 'P0001' && error.message.includes('finalization_conflict')) {
      throw new StructuredError('finalization_conflict', 'Animation finalization conflicts with durable state.', 409);
    }
    throw new StructuredError('animation_finalize_failed', 'Animation finalization could not be completed.', 500);
  }
  const finalJob: AnimationJobRow | undefined = Array.isArray(data) ? data[0] : data;
  if (!finalJob || finalJob.status !== 'completed') {
    throw new StructuredError('animation_finalize_failed', 'Animation finalization returned invalid state.', 500);
  }
  return finalJob;
}

function completionDependencies(
  // deno-lint-ignore no-explicit-any
  admin: any,
): CompletionDependencies {
  return {
    pollOperation: pollVeoOperation,
    downloadVideo: downloadGeneratedVideo,
    readStoredVideo: (videoPath) => readStoredVideo(admin, videoPath),
    storeVideo: (videoPath, video) => storeVideoWithoutOverwrite(admin, videoPath, video),
    markPolled: (jobId) => markAnimationJobPolled(admin, jobId),
    markDownloading: (jobId) => markAnimationJobDownloading(admin, jobId),
    markProviderFailed: (jobId, providerError) => markAnimationJobProviderFailed(admin, jobId, providerError),
    finalize: (jobId, videoPath, video) => finalizeAnimationJob(admin, jobId, videoPath, video),
  };
}

async function completeExistingAnimation(
  job: AnimationJobRow,
  apiKey: string,
  dependencies: CompletionDependencies,
): Promise<CompletionResult> {
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'ambiguous') {
    return { outcome: 'state', job, providerPolled: false };
  }
  if (job.status !== 'operation_pending' && job.status !== 'downloading') {
    throw new StructuredError('animation_job_not_pollable', 'Animation job is not ready for completion.', 409);
  }
  if (!job.paid_generation_requested_at || !job.veo_operation_name) {
    throw new StructuredError('animation_job_not_pollable', 'Animation job lacks a paid operation.', 409);
  }

  const videoPath = animationVideoPath(job);
  const existingVideo = job.status === 'downloading'
    ? await dependencies.readStoredVideo(videoPath)
    : null;
  const pollResult = await dependencies.pollOperation(apiKey, job.veo_operation_name);

  if (pollResult.outcome === 'pending') {
    const pendingJob = await dependencies.markPolled(job.id);
    return { outcome: 'state', job: pendingJob, providerPolled: true };
  }
  if (pollResult.outcome === 'failed') {
    const failedJob = await dependencies.markProviderFailed(job.id, pollResult.providerError);
    return { outcome: 'state', job: failedJob, providerPolled: true };
  }
  if (pollResult.outcome === 'recoverable_error') {
    let currentJob = job;
    try {
      currentJob = await dependencies.markPolled(job.id);
    } catch {
      console.error('[animate-winner] poll timestamp persistence failed');
    }
    return {
      outcome: 'recoverable_error',
      job: currentJob,
      errorCode: pollResult.errorCode,
      message: pollResult.message,
      providerPolled: true,
      httpStatus: pollResult.httpStatus,
    };
  }

  const downloadingJob = job.status === 'operation_pending'
    ? await dependencies.markDownloading(job.id)
    : await dependencies.markPolled(job.id);
  if (downloadingJob.status === 'completed' || downloadingJob.status === 'failed' || downloadingJob.status === 'ambiguous') {
    return { outcome: 'state', job: downloadingJob, providerPolled: true };
  }
  if (downloadingJob.status !== 'downloading') {
    throw new StructuredError('animation_job_state_conflict', 'Animation job state changed during completion.', 409);
  }

  let video: VideoAsset;
  try {
    video = await dependencies.downloadVideo(apiKey, pollResult.videoUri);
  } catch (error) {
    const structured = error instanceof StructuredError
      ? error
      : new StructuredError('generated_video_download_failed', 'The generated video could not be downloaded.', 502);
    return {
      outcome: 'recoverable_error',
      job: downloadingJob,
      errorCode: structured.code,
      message: structured.message,
      providerPolled: true,
    };
  }

  let storageDisposition: 'existing' | 'uploaded' | 'race_recovered';
  if (existingVideo) {
    if (!(await videosMatch(existingVideo, video))) {
      return {
        outcome: 'recoverable_error',
        job: downloadingJob,
        errorCode: 'animation_storage_conflict',
        message: 'A different object already exists at the animation storage path.',
        providerPolled: true,
      };
    }
    storageDisposition = 'existing';
  } else {
    try {
      storageDisposition = await dependencies.storeVideo(videoPath, video);
    } catch (error) {
      const structured = error instanceof StructuredError
        ? error
        : new StructuredError('animation_storage_upload_failed', 'The animation could not be stored.', 502);
      return {
        outcome: 'recoverable_error',
        job: downloadingJob,
        errorCode: structured.code,
        message: structured.message,
        providerPolled: true,
      };
    }
  }

  try {
    const completed = await dependencies.finalize(job.id, videoPath, video);
    return { outcome: 'state', job: completed, providerPolled: true, storageDisposition };
  } catch (error) {
    const structured = error instanceof StructuredError
      ? error
      : new StructuredError('animation_finalize_failed', 'Animation finalization could not be completed.', 500);
    return {
      outcome: 'recoverable_error',
      job: downloadingJob,
      errorCode: structured.code,
      message: structured.message,
      providerPolled: true,
    };
  }
}

function completionResponse(result: CompletionResult): Response {
  const payload = {
    ...jobResponsePayload(result.job.round_submission_id, result.job),
    providerPolled: result.providerPolled,
    videoReady: result.job.status === 'completed',
    automaticGenerationRetryAllowed: false,
  };
  if (result.outcome === 'state') {
    return jsonResponse({ ...payload, storageDisposition: result.storageDisposition ?? null });
  }
  return jsonResponse(
    {
      ...payload,
      error: result.errorCode,
      message: result.message,
      providerHttpStatus: result.httpStatus ?? null,
      completionRetryAllowed: true,
    },
    result.errorCode === 'animation_storage_conflict' || result.errorCode.endsWith('_conflict') ? 409 : 502,
  );
}

function resolveVeoApiKey(): string {
  const apiKey = Deno.env.get('GEMINI_API_KEY')?.trim();
  if (!apiKey) {
    console.error('[animate-winner] Veo API credential is not configured');
    throw new StructuredError('server_misconfigured', 'Winner animation is not configured.', 500);
  }
  return apiKey;
}

async function listSweepAnimationJobs(
  // deno-lint-ignore no-explicit-any
  admin: any,
  limit: number,
): Promise<AnimationJobRow[]> {
  const { data, error } = await admin
    .from('animation_jobs')
    .select(ANIMATION_JOB_SELECT)
    .in('status', ['operation_pending', 'downloading'])
    .not('paid_generation_requested_at', 'is', null)
    .not('veo_operation_name', 'is', null)
    .order('last_polled_at', { ascending: true, nullsFirst: true })
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw new StructuredError('db_error', 'Animation sweep jobs could not be loaded.', 500);
  return data ?? [];
}

async function runCompletionSweep(
  jobs: AnimationJobRow[],
  apiKey: string,
  dependencies: CompletionDependencies,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  for (const job of jobs.slice(0, MAX_SWEEP_LIMIT)) {
    try {
      const result = await completeExistingAnimation(job, apiKey, dependencies);
      results.push({
        jobId: job.id,
        outcome: result.outcome,
        jobStatus: result.job.status,
        providerPolled: result.providerPolled,
        error: result.outcome === 'recoverable_error' ? result.errorCode : null,
      });
    } catch (error) {
      const structured = error instanceof StructuredError
        ? error
        : new StructuredError('unexpected_error', 'Animation sweep item failed unexpectedly.', 500);
      if (!(error instanceof StructuredError)) console.error('[animate-winner] sweep item failed unexpectedly');
      results.push({
        jobId: job.id,
        outcome: 'error',
        jobStatus: job.status,
        providerPolled: false,
        error: structured.code,
      });
    }
  }
  return results;
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

  if (request.action === 'status') {
    try {
      await verifyPlayerOwnership(admin, request.playerId, request.playerSecret);
      const { roundSubmissionId } = await verifyWinnerSubmission(
        admin,
        request.gameId,
        request.roundId,
        request.playerId,
      );
      const job = await findAnimationJobById(admin, request.jobId);
      if (
        job.game_id !== request.gameId ||
        job.round_id !== request.roundId ||
        job.player_id !== request.playerId ||
        job.round_submission_id !== roundSubmissionId
      ) {
        throw new StructuredError('animation_job_mismatch', 'Animation job does not match the winner request.', 409);
      }

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'ambiguous') {
        return completionResponse({ outcome: 'state', job, providerPolled: false });
      }
      if (job.status !== 'operation_pending' && job.status !== 'downloading') {
        return jsonResponse({
          ...jobResponsePayload(roundSubmissionId, job),
          providerPolled: false,
          videoReady: false,
          automaticGenerationRetryAllowed: false,
        });
      }

      const result = await completeExistingAnimation(job, resolveVeoApiKey(), completionDependencies(admin));
      console.log('[animate-winner] status_processed', {
        jobStatus: result.job.status,
        outcome: result.outcome,
        providerPolled: result.providerPolled,
      });
      return completionResponse(result);
    } catch (error) {
      const structured = error instanceof StructuredError
        ? error
        : new StructuredError('unexpected_error', 'Animation status failed unexpectedly.', 500);
      if (!(error instanceof StructuredError)) console.error('[animate-winner] status failed unexpectedly');
      console.log('[animate-winner] status_failed', { code: structured.code });
      return jsonResponse(
        {
          error: structured.code,
          message: structured.message,
          automaticGenerationRetryAllowed: false,
        },
        structured.status,
      );
    }
  }

  if (request.action === 'sweep') {
    const limit = request.limit ?? DEFAULT_SWEEP_LIMIT;
    try {
      const jobs = await listSweepAnimationJobs(admin, limit);
      if (!jobs.length) {
        return jsonResponse({ action: 'sweep', requestedLimit: limit, processed: 0, results: [] });
      }

      const apiKey = resolveVeoApiKey();
      const dependencies = completionDependencies(admin);
      const results = await runCompletionSweep(jobs, apiKey, dependencies);
      console.log('[animate-winner] sweep_processed', { requestedLimit: limit, processed: results.length });
      return jsonResponse({ action: 'sweep', requestedLimit: limit, processed: results.length, results });
    } catch (error) {
      const structured = error instanceof StructuredError
        ? error
        : new StructuredError('unexpected_error', 'Animation sweep failed unexpectedly.', 500);
      if (!(error instanceof StructuredError)) console.error('[animate-winner] sweep failed unexpectedly');
      console.log('[animate-winner] sweep_failed', { code: structured.code });
      return jsonResponse({ error: structured.code, message: structured.message }, structured.status);
    }
  }

  if (request.action === 'start') {
    try {
      await verifyPlayerOwnership(admin, request.playerId, request.playerSecret);
      console.log('[animate-winner] start_authorized');

      const { roundSubmissionId, characterizedPath } = await verifyWinnerSubmission(
        admin,
        request.gameId,
        request.roundId,
        request.playerId,
      );
      console.log('[animate-winner] start_verified');

      let job = await findExistingAnimationJob(admin, roundSubmissionId);
      if (job?.paid_generation_requested_at) {
        console.log('[animate-winner] start_job_reused');
        return jsonResponse(jobResponsePayload(roundSubmissionId, job), 200);
      }

      if (!job) {
        job = await claimAnimationJob(
          admin,
          request.gameId,
          request.roundId,
          request.playerId,
          roundSubmissionId,
        );
        console.log('[animate-winner] start_job_claimed');
      }

      if (job.paid_generation_requested_at || job.status !== 'starting') {
        console.log('[animate-winner] start_job_reused');
        return jsonResponse(jobResponsePayload(roundSubmissionId, job), 200);
      }

      const veoApiKey = Deno.env.get('GEMINI_API_KEY')?.trim();
      if (!veoApiKey) {
        console.error('[animate-winner] Veo API credential is not configured');
        throw new StructuredError('server_misconfigured', 'Winner animation is not configured.', 500);
      }

      const paidClaimedJob = await claimPaidGenerationRequest(admin, job.id);
      if (!paidClaimedJob) {
        const reusedJob = await findAnimationJobById(admin, job.id);
        console.log('[animate-winner] start_paid_claim_reused');
        return jsonResponse(jobResponsePayload(roundSubmissionId, reusedJob), 200);
      }
      job = paidClaimedJob;
      console.log('[animate-winner] start_paid_claimed');

      let imageBase64: string;
      try {
        imageBase64 = await loadCharacterizedPng(admin, characterizedPath);
      } catch (error) {
        const structured = error instanceof StructuredError
          ? error
          : new StructuredError(
            'source_image_read_failed',
            'The characterized source image could not be prepared after the paid claim.',
            502,
          );
        const failedJob = await updateAnimationJob(admin, job.id, {
          status: 'failed',
          provider: 'veo',
          provider_model: VEO_MODEL,
          provider_error_code: null,
          provider_error_status: null,
          error_code: structured.code,
          error_message: structured.message,
          failed_at: new Date().toISOString(),
        });
        console.log('[animate-winner] start_source_failed', { code: structured.code });
        return jsonResponse(
          {
            ...jobResponsePayload(roundSubmissionId, failedJob),
            error: structured.code,
            message: structured.message,
            automaticRetryAllowed: false,
          },
          structured.status,
        );
      }

      // Exactly one call site exists for the one-shot paid Veo create helper.
      // Reaching it requires this invocation's successful atomic DB claim.
      const createResult = await createVeoAnimation(veoApiKey, ANIMATION_PROMPT, imageBase64);

      try {
        if (createResult.outcome === 'accepted') {
          const pendingJob = await updateAnimationJob(admin, job.id, {
            status: 'operation_pending',
            provider: 'veo',
            provider_model: VEO_MODEL,
            veo_operation_name: createResult.operationName,
            provider_error_code: null,
            provider_error_status: null,
            error_code: null,
            error_message: null,
            failed_at: null,
          });
          console.log('[animate-winner] start_provider_accepted', {
            providerHttpStatus: createResult.httpStatus,
          });
          return jsonResponse(
            {
              ...jobResponsePayload(roundSubmissionId, pendingJob),
              providerAccepted: true,
              providerHttpStatus: createResult.httpStatus,
            },
            200,
            1,
          );
        }

        if (createResult.outcome === 'rejected') {
          const failedJob = await updateAnimationJob(admin, job.id, {
            status: 'failed',
            provider: 'veo',
            provider_model: VEO_MODEL,
            provider_error_code: createResult.providerError.code === null
              ? null
              : String(createResult.providerError.code).slice(0, 200),
            provider_error_status: createResult.providerError.status,
            error_code: 'veo_create_rejected',
            error_message: createResult.providerError.message,
            failed_at: new Date().toISOString(),
          });
          console.log('[animate-winner] start_provider_rejected', {
            providerHttpStatus: createResult.httpStatus,
            providerErrorCode: createResult.providerError.code,
            providerErrorStatus: createResult.providerError.status,
          });
          return jsonResponse(
            {
              ...jobResponsePayload(roundSubmissionId, failedJob),
              error: 'veo_create_rejected',
              message: createResult.providerError.message,
              providerAccepted: false,
              providerHttpStatus: createResult.httpStatus,
              automaticRetryAllowed: false,
            },
            502,
            1,
          );
        }

        const ambiguousJob = await updateAnimationJob(admin, job.id, {
          status: 'ambiguous',
          provider: 'veo',
          provider_model: VEO_MODEL,
          provider_error_code: null,
          provider_error_status: null,
          error_code: createResult.errorCode,
          error_message: createResult.message,
          failed_at: null,
        });
        console.log('[animate-winner] start_provider_ambiguous', {
          providerHttpStatus: createResult.httpStatus,
          code: createResult.errorCode,
        });
        return jsonResponse(
          {
            ...jobResponsePayload(roundSubmissionId, ambiguousJob),
            error: createResult.errorCode,
            message: createResult.message,
            providerAccepted: null,
            providerHttpStatus: createResult.httpStatus,
            automaticRetryAllowed: false,
          },
          502,
          1,
        );
      } catch (error) {
        console.error('[animate-winner] provider result persistence failed');
        const structured = error instanceof StructuredError
          ? error
          : new StructuredError('db_error', 'The provider result could not be persisted.', 500);
        return jsonResponse(
          {
            error: structured.code,
            message: `${structured.message} The paid marker remains set; do not retry start.`,
            jobId: job.id,
            automaticRetryAllowed: false,
          },
          structured.status,
          1,
        );
      }
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

  return jsonResponse({ error: 'invalid_action', message: 'Unsupported animate-winner action.' }, 400);
});
