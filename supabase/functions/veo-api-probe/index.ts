// Milestone 4C, Step 1 only: developer-controlled Veo API probe.
//
// This function is deliberately isolated from gameplay and accepts only a
// named Supabase secret API key. It does not persist jobs or videos.
// `start` sends exactly one paid generation request and never retries it;
// `poll` only reads the operation returned by that request.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

const CHARACTERIZED_BUCKET = 'characterized';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const VEO_MODEL = 'veo-3.1-generate-preview';
const CREATE_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 20_000;
const DOWNLOAD_INSPECTION_TIMEOUT_MS = 30_000;

const PROBE_PROMPT = `Animate this exact character with one small playful, funny motion.

Preserve the character's identity, silhouette, unusual proportions, colors,
asymmetry, facial features, limb count, and every recognizable weird detail.

Do not redesign, beautify, normalize, replace, or reinterpret the character.
Keep the composition and background simple and stable. Use only one small
movement such as a wobble, waddle, bounce, blink, tail wag, stumble, or
surprised reaction.

No cuts. No dramatic camera movement. No new characters. No extra limbs.
No text.`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

interface ProbeBody {
  action?: 'start' | 'poll';
  gameId?: string;
  roundId?: string;
  playerId?: string;
  operationName?: string;
}

interface ProviderErrorSummary {
  code: number | string | null;
  status: string | null;
  message: string;
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Resolves one explicitly named Supabase secret API key from the runtime's
 * JSON map. The map may contain multiple independently rotatable keys, so
 * choosing the first entry or assuming a conventional name would be unsafe.
 * Never include the map, selected value, or supplied name in an error/log.
 */
function resolveSupabaseSecretKey(): string {
  const keyName = Deno.env.get('VEO_PROBE_SUPABASE_SECRET_KEY_NAME')?.trim();
  if (!keyName) {
    throw new StructuredError(
      'server_misconfigured',
      'VEO_PROBE_SUPABASE_SECRET_KEY_NAME is not configured for the Veo probe.',
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
  if (!Object.prototype.hasOwnProperty.call(secretKeys, keyName)) {
    throw new StructuredError('server_misconfigured', 'The configured Supabase secret key name was not found.', 500);
  }

  const selectedKey = secretKeys[keyName];
  if (
    typeof selectedKey !== 'string' ||
    selectedKey !== selectedKey.trim() ||
    !selectedKey.startsWith('sb_secret_') ||
    selectedKey.length <= 'sb_secret_'.length
  ) {
    throw new StructuredError('server_misconfigured', 'The configured Supabase secret credential is invalid.', 500);
  }

  return selectedKey;
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
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
    status: typeof error.status === 'string' ? error.status : null,
    message: typeof error.message === 'string' ? error.message.slice(0, 2000) : fallback,
  };
}

/** Returns structure and primitive types only; string values such as URIs are never exposed. */
function describeShape(value: unknown, depth = 0): unknown {
  if (depth >= 6) return Array.isArray(value) ? 'array' : typeof value;
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length, item: value.length ? describeShape(value[0], depth + 1) : null };
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, describeShape(child, depth + 1)]),
    );
  }
  return value === null ? 'null' : typeof value;
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { nonJsonResponse: text.slice(0, 1000) };
  }
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

async function startProbe(body: ProbeBody, geminiKey: string, supabaseSecretKey: string): Promise<Response> {
  const { gameId, roundId, playerId } = body;
  if (!gameId || !roundId || !playerId) {
    return jsonResponse({ error: 'missing_params', message: 'start requires gameId, roundId and playerId.' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, supabaseSecretKey);
  const { data: round, error: roundError } = await admin
    .from('rounds')
    .select('id, winner_player_id')
    .eq('id', roundId)
    .eq('game_id', gameId)
    .maybeSingle();
  if (roundError) return jsonResponse({ error: 'db_error', message: roundError.message }, 500);
  if (!round) return jsonResponse({ error: 'round_not_found', message: 'No such round in that game.' }, 404);
  if (round.winner_player_id !== playerId) {
    return jsonResponse({ error: 'not_winner', message: 'The requested player is not the persisted round winner.' }, 409);
  }

  const { data: submission, error: submissionError } = await admin
    .from('round_submissions')
    .select('characterized_path, characterization_status')
    .eq('round_id', roundId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (submissionError) return jsonResponse({ error: 'db_error', message: submissionError.message }, 500);
  if (!submission?.characterized_path || submission.characterization_status !== 'completed') {
    return jsonResponse({ error: 'character_not_ready', message: 'The winner has no completed characterized PNG.' }, 409);
  }

  const { data: imageBlob, error: downloadError } = await admin.storage
    .from(CHARACTERIZED_BUCKET)
    .download(submission.characterized_path);
  if (downloadError || !imageBlob) {
    return jsonResponse(
      { error: 'character_download_failed', message: downloadError?.message ?? 'Character download failed.' },
      502,
    );
  }

  const imageBase64 = encodeBase64(new Uint8Array(await imageBlob.arrayBuffer()));
  const endpoint = `${GEMINI_BASE_URL}/models/${VEO_MODEL}:predictLongRunning`;
  const requestBody = {
    instances: [
      {
        prompt: PROBE_PROMPT,
        image: { inlineData: { mimeType: 'image/png', data: imageBase64 } },
      },
    ],
    parameters: {
      aspectRatio: '9:16',
      durationSeconds: '4',
      resolution: '720p',
      numberOfVideos: 1,
      personGeneration: 'allow_adult',
    },
  };

  let generationResponse: Response;
  try {
    // This is the only paid-generation request in this invocation. Raw fetch
    // does not retry it, and no catch/fallback path sends a second request.
    generationResponse = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify(requestBody),
      },
      CREATE_TIMEOUT_MS,
    );
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return jsonResponse(
      {
        error: timedOut ? 'generation_creation_timeout_ambiguous_do_not_retry' : 'generation_creation_network_error',
        message: timedOut
          ? 'The creation response timed out. Google may have accepted it; do not invoke start again.'
          : error instanceof Error
            ? error.message
            : 'Generation creation failed.',
      },
      502,
    );
  }

  const payload = await parseJsonResponse(generationResponse);
  if (!generationResponse.ok) {
    return jsonResponse(
      {
        accepted: false,
        model: VEO_MODEL,
        generationHttpStatus: generationResponse.status,
        providerError: providerErrorSummary(payload, `Veo returned HTTP ${generationResponse.status}.`),
        responseShape: describeShape(payload),
        automaticRetryPerformed: false,
      },
      generationResponse.status,
    );
  }

  const operationName =
    payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).name === 'string'
      ? ((payload as Record<string, unknown>).name as string)
      : null;
  if (!operationName) {
    return jsonResponse(
      {
        accepted: true,
        error: 'operation_name_missing',
        generationHttpStatus: generationResponse.status,
        responseShape: describeShape(payload),
        message: 'Veo accepted the request but returned no recognizable operation name. Do not invoke start again.',
      },
      502,
    );
  }

  return jsonResponse({
    accepted: true,
    model: VEO_MODEL,
    endpoint: `/v1beta/models/${VEO_MODEL}:predictLongRunning`,
    generationHttpStatus: generationResponse.status,
    operationName,
    operationResponseShape: describeShape(payload),
    requestSummary: {
      instances: [{ prompt: '<fixed preservation-first prompt>', image: { inlineData: { mimeType: 'image/png', data: '<redacted>' } } }],
      parameters: requestBody.parameters,
    },
    paidGenerationRequestsThisInvocation: 1,
    automaticRetryPerformed: false,
  });
}

async function inspectAuthenticatedDownload(videoUri: string, geminiKey: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      videoUri,
      { method: 'GET', headers: { 'x-goog-api-key': geminiKey }, redirect: 'follow' },
      DOWNLOAD_INSPECTION_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      attempted: true,
      authHeader: 'x-goog-api-key',
      error: error instanceof Error ? error.message : 'Download inspection failed.',
    };
  }

  await response.body?.cancel().catch(() => undefined);
  return {
    attempted: true,
    authHeader: 'x-goog-api-key',
    httpStatus: response.status,
    redirected: response.redirected,
    finalHost: (() => {
      try {
        return new URL(response.url).host;
      } catch {
        return null;
      }
    })(),
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    bodyDownloadedOrStored: false,
  };
}

async function pollProbe(body: ProbeBody, geminiKey: string): Promise<Response> {
  const operationName = body.operationName ?? '';
  if (!isSafeOperationName(operationName)) {
    return jsonResponse({ error: 'invalid_operation_name', message: 'poll requires the exact safe operationName returned by start.' }, 400);
  }

  let pollResponse: Response;
  try {
    pollResponse = await fetchWithTimeout(
      `${GEMINI_BASE_URL}/${operationName}`,
      { method: 'GET', headers: { 'x-goog-api-key': geminiKey } },
      POLL_TIMEOUT_MS,
    );
  } catch (error) {
    return jsonResponse(
      { error: 'poll_network_error', message: error instanceof Error ? error.message : 'Operation polling failed.' },
      502,
    );
  }

  const operation = await parseJsonResponse(pollResponse);
  if (!pollResponse.ok) {
    return jsonResponse(
      {
        pollHttpStatus: pollResponse.status,
        providerError: providerErrorSummary(operation, `Operation polling returned HTTP ${pollResponse.status}.`),
        responseShape: describeShape(operation),
        paidGenerationRequestsThisInvocation: 0,
      },
      pollResponse.status,
    );
  }

  const record = operation && typeof operation === 'object' ? (operation as Record<string, unknown>) : {};
  const done = record.done === true;
  const videoUri = done ? findVideoUri(operation) : null;
  const downloadInspection = videoUri ? await inspectAuthenticatedDownload(videoUri, geminiKey) : null;

  return jsonResponse({
    model: VEO_MODEL,
    pollingEndpoint: `/v1beta/${operationName}`,
    pollHttpStatus: pollResponse.status,
    done,
    operationResponseShape: describeShape(operation),
    providerError: record.error ? providerErrorSummary(record.error, 'The operation failed.') : null,
    generatedVideoReference: videoUri
      ? {
          uriPresent: true,
          scheme: (() => {
            try {
              return new URL(videoUri).protocol;
            } catch {
              return null;
            }
          })(),
          host: (() => {
            try {
              return new URL(videoUri).host;
            } catch {
              return null;
            }
          })(),
          rawUriExposed: false,
        }
      : null,
    downloadInspection,
    paidGenerationRequestsThisInvocation: 0,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  let supabaseSecretKey: string;
  try {
    supabaseSecretKey = resolveSupabaseSecretKey();
  } catch (err) {
    const structured =
      err instanceof StructuredError
        ? err
        : new StructuredError('server_misconfigured', 'The Supabase probe credential could not be resolved.', 500);
    console.error('[veo-api-probe] Supabase probe credential is not configured');
    return jsonResponse({ error: structured.code, message: structured.message }, structured.status);
  }

  if (!isSecretKeyRequest(req, supabaseSecretKey)) {
    return jsonResponse({ error: 'forbidden', message: 'This developer probe requires secret-key authorization.' }, 403);
  }

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) return jsonResponse({ error: 'server_misconfigured', message: 'GEMINI_API_KEY is not configured.' }, 500);

  let body: ProbeBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json', message: 'Request body must be JSON.' }, 400);
  }

  if (body.action === 'start') return startProbe(body, geminiKey, supabaseSecretKey);
  if (body.action === 'poll') return pollProbe(body, geminiKey);
  return jsonResponse({ error: 'invalid_action', message: "action must be 'start' or 'poll'." }, 400);
});
