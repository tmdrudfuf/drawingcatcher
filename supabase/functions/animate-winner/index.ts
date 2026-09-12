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
  try {
    supabaseSecretKey = resolveSupabaseSecretKey();
    createAdminClient(supabaseSecretKey);
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

  return notImplemented(request.action);
});
