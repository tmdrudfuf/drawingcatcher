// Offline unit tests for the rewarded-ad-ssv Edge Function. No network, no
// database -- handleSsvCallback takes an injected VerifierKeyStore and
// grantEntitlement dependency (same pattern as animate-winner's
// CompletionDependencies), and derEcdsaSignatureToRaw is tested directly
// against hand-built DER bytes so the two shapes that break a naive
// DER->raw converter (a leading 0x00 pad byte, and a component shorter than
// 32 bytes) are covered deterministically rather than by hoping a random
// signature happens to hit them.
//
// Run with: npx deno test supabase/functions/rewarded-ad-ssv/index.test.ts
//
// Imports from ./verification.ts, deliberately NOT ./index.ts: index.ts has
// a bare top-level `Deno.serve(...)` call (unchanged, matching every other
// Edge Function in this project), which would run as an import side effect
// and start a live HTTP listener during `deno test`. verification.ts holds
// only pure signature-verification/callback-handling logic with no
// top-level side effects, so it is safe to import directly; index.ts
// imports the same functions from it.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  derEcdsaSignatureToRaw,
  handleSsvCallback,
  VerifierKeyStore,
  type GrantOutcome,
  type SsvDependencies,
} from './verification.ts';

// ---------------------------------------------------------------------------
// derEcdsaSignatureToRaw: pure DER-parsing tests, no crypto involved.
// ---------------------------------------------------------------------------

function derInteger(bytes: number[]): number[] {
  return [0x02, bytes.length, ...bytes];
}

function derSequence(parts: number[][]): Uint8Array {
  const body = parts.flat();
  return new Uint8Array([0x30, body.length, ...body]);
}

Deno.test('derEcdsaSignatureToRaw: pads a short component with leading zeros', () => {
  // s naturally encodes in fewer than 32 bytes (its high byte(s) were zero).
  const r = new Array(32).fill(1); // exactly 32, no leading zero
  const s = [1, 2, 3]; // 3 bytes -- must become 0x00*29 + 01 02 03
  const der = derSequence([derInteger(r), derInteger(s)]);
  const raw = derEcdsaSignatureToRaw(der);
  assertEquals(raw.length, 64);
  assertEquals(Array.from(raw.slice(0, 32)), r);
  const expectedS = new Array(29).fill(0).concat([1, 2, 3]);
  assertEquals(Array.from(raw.slice(32)), expectedS);
});

Deno.test('derEcdsaSignatureToRaw: strips a DER high-bit pad byte back to 32 bytes', () => {
  // r's true value is 32 bytes starting with 0xFF (high bit set), so DER
  // prepends a 0x00 pad byte to keep the INTEGER non-negative -> 33 bytes
  // on the wire. The raw form must be exactly the original 32 bytes back.
  const rValue = [0xff, ...new Array(31).fill(0x05)];
  const rDerBytes = [0x00, ...rValue]; // 33 bytes as it appears on the wire
  const s = new Array(32).fill(0x02);
  const der = derSequence([derInteger(rDerBytes), derInteger(s)]);
  const raw = derEcdsaSignatureToRaw(der);
  assertEquals(raw.length, 64);
  assertEquals(Array.from(raw.slice(0, 32)), rValue);
  assertEquals(Array.from(raw.slice(32)), s);
});

Deno.test('derEcdsaSignatureToRaw: rejects a non-SEQUENCE input', () => {
  let threw = false;
  try {
    derEcdsaSignatureToRaw(new Uint8Array([0x04, 0x02, 0x00, 0x00]));
  } catch {
    threw = true;
  }
  assert(threw, 'expected a malformed_signature error');
});

// ---------------------------------------------------------------------------
// End-to-end fixture: a real P-256 key pair, a real signature, converted to
// DER the way Google's callback actually arrives.
// ---------------------------------------------------------------------------

function rawSignatureToDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  const toInteger = (component: Uint8Array): number[] => {
    let bytes = Array.from(component);
    while (bytes.length > 1 && bytes[0] === 0x00 && (bytes[1] & 0x80) === 0) bytes = bytes.slice(1);
    if (bytes[0] & 0x80) bytes = [0x00, ...bytes];
    return bytes;
  };
  const r = toInteger(raw.slice(0, half));
  const s = toInteger(raw.slice(half));
  return derSequence([derInteger(r), derInteger(s)]);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface Fixture {
  content: string;
  fullQuery: string;
  keyId: string;
  transactionId: string;
  token: string;
  keyStore: VerifierKeyStore;
}

async function buildFixture(overrides?: { keyId?: string; transactionId?: string; token?: string }): Promise<Fixture> {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const keyId = overrides?.keyId ?? '1';
  const transactionId = overrides?.transactionId ?? 'tx-abc-123';
  const token = overrides?.token ?? 'a'.repeat(64);

  const content =
    `ad_network=5450213213286189855&ad_unit=ca-app-pub-3940256099942544%2F5224354917` +
    `&reward_amount=1&reward_item=coin&timestamp=1234567890123` +
    `&transaction_id=${transactionId}&custom_data=${encodeURIComponent(token)}`;

  const rawSignature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, new TextEncoder().encode(content)),
  );
  const der = rawSignatureToDer(rawSignature);
  const signatureParam = base64UrlEncode(der);
  const fullQuery = `${content}&signature=${signatureParam}&key_id=${keyId}`;

  let fetchCount = 0;
  const fakeFetch: typeof fetch = async () => {
    fetchCount += 1;
    return new Response(
      JSON.stringify({ keys: [{ keyId, base64: btoa(String.fromCharCode(...new Uint8Array(spki))) }] }),
      { status: 200 },
    );
  };
  const keyStore = new VerifierKeyStore(fakeFetch);
  return { content, fullQuery, keyId, transactionId, token, keyStore };
}

function spyDeps(outcome: GrantOutcome, keyStore: VerifierKeyStore): { deps: SsvDependencies; calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    deps: {
      keyStore,
      grantEntitlement: async (token, transactionId, keyId) => {
        calls.push([token, transactionId, keyId]);
        return { outcome, entitlementId: outcome === 'granted' ? 'entitlement-1' : null };
      },
    },
  };
}

// A. valid verified SSV -> one rewarded_ad entitlement.
Deno.test('A: valid signature + granted outcome returns 200 and calls grantEntitlement once', async () => {
  const fixture = await buildFixture();
  const { deps, calls } = spyDeps('granted', fixture.keyStore);
  const res = await handleSsvCallback(`https://example.com/rewarded-ad-ssv?${fixture.fullQuery}`, deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).outcome, 'granted');
  assertEquals(calls.length, 1);
  assertEquals(calls[0], [fixture.token, fixture.transactionId, fixture.keyId]);
});

// B. duplicate same transaction_id -> the handler relays 'replayed' as a
// terminal, non-error 200 (uniqueness itself is enforced by the
// transaction_id PRIMARY KEY + atomic upsert in grant_rewarded_ad_entitlement
// -- see the M4E migration -- which this offline test cannot exercise; DB
// concurrency is asserted at the SQL level, not here).
Deno.test('B: replayed outcome from a duplicate transaction_id is relayed as 200, not an error', async () => {
  const fixture = await buildFixture();
  const { deps } = spyDeps('replayed', fixture.keyStore);
  const res = await handleSsvCallback(`https://example.com/rewarded-ad-ssv?${fixture.fullQuery}`, deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).outcome, 'replayed');
});

// C. invalid signature -> no entitlement. Signs the exact same content with
// a DIFFERENT key pair, so the signature is structurally well-formed (valid
// DER, valid base64url) but does not verify against the public key the
// (unmodified) key server serves for key_id '1' -- a clean, deterministic
// "wrong signature" rather than a fragile byte-flip that could coincidally
// still decode.
Deno.test('C: a well-formed signature from the wrong key is rejected before grantEntitlement runs', async () => {
  const fixture = await buildFixture();
  const wrongKeyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const wrongSignature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      wrongKeyPair.privateKey,
      new TextEncoder().encode(fixture.content),
    ),
  );
  const wrongSignatureParam = base64UrlEncode(rawSignatureToDer(wrongSignature));
  const tamperedQuery = `${fixture.content}&signature=${wrongSignatureParam}&key_id=${fixture.keyId}`;
  const { deps, calls } = spyDeps('granted', fixture.keyStore);
  const res = await handleSsvCallback(`https://example.com/rewarded-ad-ssv?${tamperedQuery}`, deps);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'invalid_signature');
  assertEquals(calls.length, 0);
});

// D. unknown key_id -> no entitlement.
Deno.test('D: a key_id absent from the verifier key response is rejected', async () => {
  const fixture = await buildFixture({ keyId: '1' });
  const wrongKeyIdQuery = fixture.fullQuery.replace(/key_id=1$/, 'key_id=999');
  const { deps, calls } = spyDeps('granted', fixture.keyStore);
  const res = await handleSsvCallback(`https://example.com/rewarded-ad-ssv?${wrongKeyIdQuery}`, deps);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'unknown_key_id');
  assertEquals(calls.length, 0);
});

// E. missing/malformed parameters -> no entitlement.
Deno.test('E: a callback with no signature parameter at all is rejected as malformed', async () => {
  const { deps, calls } = spyDeps('granted', new VerifierKeyStore(async () => new Response('{}', { status: 200 })));
  const res = await handleSsvCallback('https://example.com/rewarded-ad-ssv?ad_network=1&transaction_id=tx1', deps);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'malformed_callback');
  assertEquals(calls.length, 0);
});

Deno.test('E: a verified callback missing transaction_id/custom_data is rejected without granting', async () => {
  const fixture = await buildFixture();
  // Sign different content that omits transaction_id/custom_data entirely,
  // so the signature is genuinely valid over what was actually signed.
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const content = 'ad_network=1&reward_amount=1';
  const rawSignature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, new TextEncoder().encode(content)),
  );
  const signatureParam = base64UrlEncode(rawSignatureToDer(rawSignature));
  const query = `${content}&signature=${signatureParam}&key_id=1`;
  const keyStore = new VerifierKeyStore(
    async () =>
      new Response(JSON.stringify({ keys: [{ keyId: '1', base64: btoa(String.fromCharCode(...new Uint8Array(spki))) }] }), {
        status: 200,
      }),
  );
  const { deps, calls } = spyDeps('granted', keyStore);
  const res = await handleSsvCallback(`https://example.com/rewarded-ad-ssv?${query}`, deps);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'missing_required_field');
  assertEquals(calls.length, 0);
});

// F. invalid correlation -> no entitlement.
Deno.test('F: correlation_invalid outcome is relayed without treating it as granted', async () => {
  const fixture = await buildFixture();
  const { deps } = spyDeps('correlation_invalid', fixture.keyStore);
  const res = await handleSsvCallback(`https://example.com/rewarded-ad-ssv?${fixture.fullQuery}`, deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).outcome, 'correlation_invalid');
});

// G. expired correlation -> no entitlement.
Deno.test('G: correlation_expired outcome is relayed without treating it as granted', async () => {
  const fixture = await buildFixture();
  const { deps } = spyDeps('correlation_expired', fixture.keyStore);
  const res = await handleSsvCallback(`https://example.com/rewarded-ad-ssv?${fixture.fullQuery}`, deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).outcome, 'correlation_expired');
});

// Key-server outage: fails closed with a 5xx (retry may help), never grants.
Deno.test('key server outage fails closed with a 5xx and never calls grantEntitlement', async () => {
  const fixture = await buildFixture();
  const brokenKeyStore = new VerifierKeyStore(async () => new Response('nope', { status: 503 }));
  const { deps, calls } = spyDeps('granted', brokenKeyStore);
  const res = await handleSsvCallback(`https://example.com/rewarded-ad-ssv?${fixture.fullQuery}`, deps);
  assertEquals(res.status, 502);
  assertEquals(calls.length, 0);
});
