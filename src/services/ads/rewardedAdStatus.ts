import { supabase, supabaseConfigError } from '@/providers/supabase/supabase';

export interface RewardedAdStatusInput {
  gameId: string;
  roundId: string;
  playerId: string;
  playerSecret: string;
}

export type RewardedAdStatusResult =
  | { status: 'checked'; verified: boolean; count: number }
  | { status: 'error'; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function errorResult(code: string, message: string): RewardedAdStatusResult {
  return { status: 'error', code, message };
}

/**
 * Validates animate-winner's 'rewarded-ad-status' response. This is a
 * read-only existence/count check for a verified rewarded_ad entitlement --
 * it never starts anything and the server never returns an entitlement id,
 * transaction id, or any other DB internal in this response.
 */
export function parseRewardedAdStatusResponse(value: unknown): RewardedAdStatusResult {
  if (!isRecord(value)) {
    return errorResult('invalid_response', 'Rewarded ad status returned an invalid response.');
  }
  if (nonEmptyString(value.error)) {
    return errorResult(
      value.error,
      nonEmptyString(value.message) ? value.message : 'Rewarded ad status could not be checked.',
    );
  }
  if (typeof value.verified !== 'boolean' || typeof value.count !== 'number' || !Number.isFinite(value.count)) {
    return errorResult('invalid_response', 'Rewarded ad status returned an incomplete result.');
  }
  return { status: 'checked', verified: value.verified, count: value.count };
}

export async function getRewardedAdStatus(input: RewardedAdStatusInput): Promise<RewardedAdStatusResult> {
  if (!supabase) {
    return errorResult('client_not_configured', supabaseConfigError ?? 'Supabase is not available.');
  }

  try {
    const { data, error } = await supabase.functions.invoke<unknown>('animate-winner', {
      body: {
        action: 'rewarded-ad-status',
        gameId: input.gameId,
        roundId: input.roundId,
        playerId: input.playerId,
        playerSecret: input.playerSecret,
      },
    });
    if (error) return errorResult('request_failed', 'Rewarded ad status request failed.');
    return parseRewardedAdStatusResponse(data);
  } catch {
    return errorResult('request_failed', 'Rewarded ad status request failed.');
  }
}
