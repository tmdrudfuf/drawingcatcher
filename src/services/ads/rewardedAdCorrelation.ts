import { supabase, supabaseConfigError } from '@/providers/supabase/supabase';

export interface RewardedAdCorrelationInput {
  gameId: string;
  roundId: string;
  playerId: string;
  playerSecret: string;
}

export type RewardedAdCorrelationResult =
  | { status: 'ready'; token: string; expiresInSeconds: number }
  | { status: 'error'; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function errorResult(code: string, message: string): RewardedAdCorrelationResult {
  return { status: 'error', code, message };
}

/**
 * Validates animate-winner's 'request-rewarded-ad-correlation' response.
 * The returned token is an OPAQUE, server-issued, single-use value -- see
 * RewardedAdSsvCorrelation in src/services/ads/RewardedAdProvider.ts. It is
 * never a credential and must only ever be forwarded as SSV
 * userId/customData, never persisted or logged.
 */
export function parseRewardedAdCorrelationResponse(value: unknown): RewardedAdCorrelationResult {
  if (!isRecord(value)) {
    return errorResult('invalid_response', 'Rewarded ad correlation returned an invalid response.');
  }
  if (nonEmptyString(value.error)) {
    return errorResult(
      value.error,
      nonEmptyString(value.message) ? value.message : 'Rewarded ad correlation could not be requested.',
    );
  }
  if (
    !nonEmptyString(value.correlationToken) ||
    typeof value.expiresInSeconds !== 'number' ||
    !Number.isFinite(value.expiresInSeconds) ||
    value.expiresInSeconds <= 0
  ) {
    return errorResult('invalid_response', 'Rewarded ad correlation returned an incomplete token.');
  }
  return { status: 'ready', token: value.correlationToken, expiresInSeconds: value.expiresInSeconds };
}

export async function getRewardedAdCorrelation(
  input: RewardedAdCorrelationInput,
): Promise<RewardedAdCorrelationResult> {
  if (!supabase) {
    return errorResult('client_not_configured', supabaseConfigError ?? 'Supabase is not available.');
  }

  try {
    const { data, error } = await supabase.functions.invoke<unknown>('animate-winner', {
      body: {
        action: 'request-rewarded-ad-correlation',
        gameId: input.gameId,
        roundId: input.roundId,
        playerId: input.playerId,
        playerSecret: input.playerSecret,
      },
    });
    if (error) return errorResult('request_failed', 'Rewarded ad correlation request failed.');
    return parseRewardedAdCorrelationResponse(data);
  } catch {
    return errorResult('request_failed', 'Rewarded ad correlation request failed.');
  }
}
