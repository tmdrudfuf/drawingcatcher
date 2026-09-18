import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleSsvCallback, jsonResponse, SsvError, VerifierKeyStore, type GrantOutcome } from './verification.ts';

// Milestone 4E step 2: Google AdMob rewarded-ad Server-Side Verification
// callback. This endpoint is a PUBLIC, unauthenticated GET webhook -- Google
// calls it directly with no apikey/Authorization header, so it cannot use
// animate-winner's playerSecret/apikey model at all. It must be deployed
// with JWT verification disabled at the gateway (see supabase/config.toml's
// [functions.rewarded-ad-ssv] section) and instead authenticates the
// caller entirely via ECDSA signature verification (verification.ts).
//
// The client's EARNED_REWARD event is NEVER trusted here or anywhere else
// -- this function is the only code path in the project that may create a
// rewarded_ad animation_entitlements row, and only after:
//   1. the callback's ECDSA signature verifies against a current AdMob
//      verifier key, and
//   2. its transaction_id has never been consumed before (replay guard),
//   3. its custom_data resolves to a still-valid, unexpired, unconsumed
//      correlation issued earlier by animate-winner's
//      'request-rewarded-ad-correlation' action.
// See supabase/migrations/202609100012_milestone4e_rewarded_ad_grant.sql
// for the atomic replay+grant transaction (grant_rewarded_ad_entitlement).
//
// This function never calls Veo and never starts an animation job -- it
// only ever grants an entitlement row. Spending it still requires a
// separate, later 'start' call through animate-winner.

function resolveSupabaseSecretKey(): string {
  const keyName = Deno.env.get('REWARDED_AD_SSV_SUPABASE_SECRET_KEY_NAME')?.trim();
  if (!keyName) {
    throw new SsvError(
      'server_misconfigured',
      'REWARDED_AD_SSV_SUPABASE_SECRET_KEY_NAME is not configured.',
      500,
    );
  }
  const rawSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!rawSecretKeys) {
    throw new SsvError('server_misconfigured', 'SUPABASE_SECRET_KEYS is unavailable.', 500);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSecretKeys);
  } catch {
    throw new SsvError('server_misconfigured', 'SUPABASE_SECRET_KEYS is not valid JSON.', 500);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SsvError('server_misconfigured', 'SUPABASE_SECRET_KEYS has an invalid structure.', 500);
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
    throw new SsvError('server_misconfigured', 'The configured Supabase secret credential is invalid.', 500);
  }
  return selectedKey;
}

function createAdminClient(secretKey: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  if (!supabaseUrl) {
    throw new SsvError('server_misconfigured', 'SUPABASE_URL is unavailable.', 500);
  }
  return createClient(supabaseUrl, secretKey);
}

const defaultKeyStore = new VerifierKeyStore();

Deno.serve(async (req) => {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed', message: 'Only GET is supported.' }, 405);
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    const supabaseSecretKey = resolveSupabaseSecretKey();
    admin = createAdminClient(supabaseSecretKey);
  } catch (error) {
    console.error('[rewarded-ad-ssv] Supabase admin credential is not configured');
    const structured = error instanceof SsvError
      ? error
      : new SsvError('server_misconfigured', 'The Supabase admin client could not be created.', 500);
    return jsonResponse({ error: structured.code, message: structured.message }, structured.status);
  }

  return await handleSsvCallback(req.url, {
    keyStore: defaultKeyStore,
    grantEntitlement: async (token, transactionId, keyId) => {
      const { data, error } = await admin.rpc('grant_rewarded_ad_entitlement', {
        p_token: token,
        p_transaction_id: transactionId,
        p_key_id: keyId,
      });
      if (error) throw new Error('grant_rpc_failed');
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row.grant_outcome !== 'string') throw new Error('grant_rpc_invalid_response');
      return { outcome: row.grant_outcome as GrantOutcome, entitlementId: row.granted_entitlement_id ?? null };
    },
  });
});
