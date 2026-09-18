// Pure SSV signature verification and callback-handling logic, split out of
// index.ts specifically so it can be imported from a Deno test file without
// also importing index.ts's own top-level `Deno.serve(...)` call as an
// unavoidable side effect of the import. This module has no top-level
// side effects of its own -- it is safe to import from anywhere, including
// Deno.env-free environments (it never touches Deno.env; that stays in
// index.ts, next to createAdminClient).

const VERIFIER_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
// Google's own guidance: "public keys should not be cached for longer than
// 24 hours" -- they rotate on a variable schedule.
const KEY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KEY_FETCH_TIMEOUT_MS = 10_000;
const P256_COMPONENT_LENGTH = 32;

export function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export class SsvError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Distinct from SsvError: a key-server outage is OUR failure to complete
 * verification, not evidence the callback is bad -- callers should map this
 * to a 5xx (retry may help) rather than a 4xx (retry never helps). */
export class KeyServerError extends Error {}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function base64StandardDecode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return base64StandardDecode(padded);
}

function readDerLength(bytes: Uint8Array, offset: number): { length: number; next: number } {
  const first = bytes[offset];
  if (first === undefined) throw new SsvError('malformed_signature', 'Truncated DER length.', 400);
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  const numBytes = first & 0x7f;
  if (numBytes === 0 || numBytes > 4) {
    throw new SsvError('malformed_signature', 'Unsupported DER length encoding.', 400);
  }
  let length = 0;
  for (let i = 0; i < numBytes; i += 1) {
    const b = bytes[offset + 1 + i];
    if (b === undefined) throw new SsvError('malformed_signature', 'Truncated DER length.', 400);
    length = (length << 8) | b;
  }
  return { length, next: offset + 1 + numBytes };
}

function readDerInteger(bytes: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  if (bytes[offset] !== 0x02) throw new SsvError('malformed_signature', 'Expected a DER INTEGER.', 400);
  const { length, next } = readDerLength(bytes, offset + 1);
  const value = bytes.slice(next, next + length);
  if (value.length !== length) throw new SsvError('malformed_signature', 'Truncated DER INTEGER.', 400);
  return { value, next: next + length };
}

/**
 * A DER INTEGER carries a leading 0x00 pad byte whenever its high bit would
 * otherwise read as negative, and drops natural leading zero bytes whenever
 * the value is small -- so its length varies per-signature. Both cases must
 * be normalized to exactly `length` bytes (big-endian, left-zero-padded) or
 * WebCrypto's raw r||s verify silently rejects some valid signatures.
 */
function toFixedLength(value: Uint8Array, length: number): Uint8Array {
  let trimmed = value;
  while (trimmed.length > length && trimmed[0] === 0x00) trimmed = trimmed.slice(1);
  if (trimmed.length > length) {
    throw new SsvError('malformed_signature', 'DER integer component is too large.', 400);
  }
  if (trimmed.length === length) return trimmed;
  const padded = new Uint8Array(length);
  padded.set(trimmed, length - trimmed.length);
  return padded;
}

/**
 * Google's AdMob SSV signature is a DER-encoded ECDSA signature (a SEQUENCE
 * of two INTEGERs, r and s). WebCrypto's `crypto.subtle.verify` for ECDSA
 * requires the signature as fixed-length raw r||s instead -- this converts
 * between the two. Exported for tests: fixtures must cover both a
 * DER-padded (0x00 high-bit pad) and a DER-short (stripped leading zero)
 * component, since a naive "just concatenate" implementation passes for
 * most random signatures and fails only on those two shapes.
 */
export function derEcdsaSignatureToRaw(der: Uint8Array, componentLength = P256_COMPONENT_LENGTH): Uint8Array {
  if (der[0] !== 0x30) throw new SsvError('malformed_signature', 'Signature is not a valid DER SEQUENCE.', 400);
  const { next: afterSeqLen } = readDerLength(der, 1);
  const r = readDerInteger(der, afterSeqLen);
  const s = readDerInteger(der, r.next);
  const raw = new Uint8Array(componentLength * 2);
  raw.set(toFixedLength(r.value, componentLength), 0);
  raw.set(toFixedLength(s.value, componentLength), componentLength);
  return raw;
}

/**
 * Fetches and caches AdMob's verifier keys, capped at 24h per Google's
 * guidance, with rotation handled by forcing one refresh whenever a
 * requested key_id isn't in the current cache (rather than only on the TTL)
 * -- a key can rotate in before the 24h cache would otherwise expire.
 */
export class VerifierKeyStore {
  private cache: { fetchedAt: number; keys: Map<string, CryptoKey> } | null = null;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxAgeMs: number = KEY_CACHE_MAX_AGE_MS,
  ) {}

  async getKey(keyId: string): Promise<CryptoKey | null> {
    if (!this.cache || Date.now() - this.cache.fetchedAt > this.maxAgeMs) {
      await this.refresh();
    }
    let key = this.cache?.keys.get(keyId) ?? null;
    if (!key) {
      await this.refresh();
      key = this.cache?.keys.get(keyId) ?? null;
    }
    return key;
  }

  private async refresh(): Promise<void> {
    let response: Response;
    try {
      response = await fetchWithTimeout(VERIFIER_KEYS_URL, KEY_FETCH_TIMEOUT_MS, this.fetchImpl);
    } catch {
      throw new KeyServerError('Verifier key fetch failed or timed out.');
    }
    if (!response.ok) throw new KeyServerError(`Verifier key server returned ${response.status}.`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new KeyServerError('Verifier key server returned invalid JSON.');
    }
    const entries = (body as { keys?: unknown })?.keys;
    if (!Array.isArray(entries)) throw new KeyServerError('Verifier key server returned an invalid response.');

    const keys = new Map<string, CryptoKey>();
    for (const entry of entries) {
      const record = entry as Record<string, unknown>;
      const keyId = record?.keyId;
      const base64 = record?.base64;
      if ((typeof keyId !== 'number' && typeof keyId !== 'string') || typeof base64 !== 'string' || !base64) {
        continue; // Skip one malformed key entry rather than failing the whole refresh.
      }
      try {
        const der = base64StandardDecode(base64);
        const publicKey = await crypto.subtle.importKey(
          'spki',
          der.slice().buffer,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify'],
        );
        keys.set(String(keyId), publicKey);
      } catch {
        continue;
      }
    }
    if (keys.size === 0) throw new KeyServerError('Verifier key server returned no usable keys.');
    this.cache = { fetchedAt: Date.now(), keys };
  }
}

interface VerifiedCallback {
  params: URLSearchParams;
  keyId: string;
}

/**
 * Verifies the callback's ECDSA signature against the exact bytes Google
 * signed. `rawQuery` MUST be the literal query string exactly as received
 * (e.g. `new URL(req.url).search.slice(1)`), never rebuilt from a parsed
 * URLSearchParams -- re-serializing can reorder or re-encode parameters,
 * which would silently break every legitimate signature. The last two
 * parameters are always `signature` then `key_id` (Google's documented
 * order); everything before them, byte-for-byte, is the signed content.
 */
async function verifySsvSignature(rawQuery: string, keyStore: VerifierKeyStore): Promise<VerifiedCallback> {
  const marker = '&signature=';
  const markerIndex = rawQuery.lastIndexOf(marker);
  if (markerIndex === -1 || markerIndex === 0) {
    throw new SsvError('malformed_callback', 'Missing signature parameter.', 400);
  }
  const content = rawQuery.slice(0, markerIndex);
  const tail = new URLSearchParams(rawQuery.slice(markerIndex + 1));
  const signatureParam = tail.get('signature');
  const keyId = tail.get('key_id');
  if (!signatureParam || !keyId) {
    throw new SsvError('malformed_callback', 'Missing signature or key_id.', 400);
  }

  let signatureDer: Uint8Array;
  try {
    signatureDer = base64UrlDecode(signatureParam);
  } catch {
    throw new SsvError('malformed_callback', 'Signature is not valid base64url.', 400);
  }
  const rawSignature = derEcdsaSignatureToRaw(signatureDer);

  const publicKey = await keyStore.getKey(keyId);
  if (!publicKey) {
    throw new SsvError('unknown_key_id', 'No verification key is available for this key_id.', 400);
  }

  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    rawSignature.slice().buffer,
    new TextEncoder().encode(content).buffer,
  );
  if (!verified) throw new SsvError('invalid_signature', 'SSV signature verification failed.', 400);

  // Parsed AFTER verification succeeds, and only for reading individual
  // field values (percent-decoding custom_data is correct here -- Google
  // documents it as percent-escaped). This URLSearchParams instance is
  // never re-serialized back into signed content.
  return { params: new URLSearchParams(content), keyId };
}

export type GrantOutcome =
  | 'granted'
  | 'replayed'
  | 'correlation_invalid'
  | 'correlation_consumed'
  | 'correlation_expired';

export interface SsvDependencies {
  keyStore: VerifierKeyStore;
  grantEntitlement: (
    token: string,
    transactionId: string,
    keyId: string,
  ) => Promise<{ outcome: GrantOutcome; entitlementId: string | null }>;
}

function isPlausibleToken(value: string | null): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= 256;
}

function isPlausibleTransactionId(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

/**
 * Handles one SSV callback end-to-end. Dependency-injected (keyStore,
 * grantEntitlement) so tests can supply a fake key server and a fake/spy
 * grant function without any network or database access -- same pattern as
 * animate-winner's CompletionDependencies/RevealStatusDependencies.
 */
export async function handleSsvCallback(requestUrl: string, deps: SsvDependencies): Promise<Response> {
  const rawQuery = new URL(requestUrl).search.slice(1);
  if (!rawQuery) {
    return jsonResponse({ error: 'malformed_callback', message: 'Missing query string.' }, 400);
  }

  let verification: VerifiedCallback;
  try {
    verification = await verifySsvSignature(rawQuery, deps.keyStore);
  } catch (error) {
    if (error instanceof KeyServerError) {
      console.error('[rewarded-ad-ssv] verifier_key_fetch_failed');
      return jsonResponse(
        { error: 'key_server_unavailable', message: 'Verification keys are unavailable.' },
        502,
      );
    }
    const structured = error instanceof SsvError
      ? error
      : new SsvError('verification_failed', 'SSV verification failed.', 400);
    console.log('[rewarded-ad-ssv] verification_failed', { code: structured.code });
    return jsonResponse({ error: structured.code, message: structured.message }, structured.status);
  }

  const transactionId = verification.params.get('transaction_id');
  const token = verification.params.get('custom_data');
  if (!isPlausibleTransactionId(transactionId) || !isPlausibleToken(token)) {
    console.log('[rewarded-ad-ssv] verification_failed', { code: 'missing_required_field' });
    return jsonResponse(
      { error: 'missing_required_field', message: 'transaction_id and custom_data are required.' },
      400,
    );
  }

  let grant: { outcome: GrantOutcome; entitlementId: string | null };
  try {
    grant = await deps.grantEntitlement(token, transactionId, verification.keyId);
  } catch {
    console.error('[rewarded-ad-ssv] grant_failed_unexpectedly');
    return jsonResponse({ error: 'grant_failed', message: 'Entitlement grant could not be completed.' }, 500);
  }

  // Never log custom_data (it is the bearer correlation token) or the
  // resolved entitlement id -- transaction_id and the outcome category are
  // enough to debug without exposing anything sensitive.
  console.log('[rewarded-ad-ssv] grant_result', { outcome: grant.outcome, transactionId });

  // All of these mean "the callback was understood and handled" -- Google
  // gains nothing by retrying any of them, so all return 200. Only
  // malformed/unverifiable callbacks (4xx, above) or our own key-server
  // outage (502, above) are responses where a retry could plausibly help.
  return jsonResponse({ outcome: grant.outcome }, 200);
}
