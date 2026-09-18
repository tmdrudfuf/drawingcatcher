// Pure request-shape and rewarded-ad-correlation logic, split out of
// index.ts specifically so it can be imported from a Deno test file without
// also importing index.ts's own top-level `Deno.serve(...)` call as an
// unavoidable side effect of the import. This module has no top-level
// side effects of its own -- it is safe to import from anywhere.

export const MAX_SWEEP_LIMIT = 10;
// M4E step 2: how long a server-issued rewarded-ad correlation token stays
// redeemable. Generous enough that "prepare the ad early, watch it later"
// never expires mid-flow, but still short-lived and single-use per the
// rewarded_ad_correlations design (see the M4E migration).
const REWARDED_AD_CORRELATION_TTL_SECONDS = 1800;
const REWARDED_AD_CORRELATION_TOKEN_BYTES = 32;

export class StructuredError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type AnimateWinnerRequest =
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
      action: 'reveal-status';
      gameId: string;
      roundId: string;
      playerId: string;
      playerSecret: string;
    }
  | {
      action: 'request-rewarded-ad-correlation';
      gameId: string;
      roundId: string;
      playerId: string;
      playerSecret: string;
    }
  | {
      // M4E step 3: read-only entitlement-existence check for the SSV E2E
      // flow (server correlation -> SSV -> verified entitlement). Never
      // starts anything -- see handleRewardedAdStatus in index.ts.
      action: 'rewarded-ad-status';
      gameId: string;
      roundId: string;
      playerId: string;
      playerSecret: string;
    }
  | {
      action: 'sweep';
      limit?: number;
    };

export function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new StructuredError('invalid_request', `${field} must be a non-empty string.`, 400);
  }
  return value.trim();
}

export function parseRequest(value: unknown): AnimateWinnerRequest {
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
  if (body.action === 'reveal-status') {
    return {
      action: 'reveal-status',
      gameId: requiredString(body, 'gameId'),
      roundId: requiredString(body, 'roundId'),
      playerId: requiredString(body, 'playerId'),
      playerSecret: requiredString(body, 'playerSecret'),
    };
  }
  if (body.action === 'request-rewarded-ad-correlation') {
    return {
      action: 'request-rewarded-ad-correlation',
      gameId: requiredString(body, 'gameId'),
      roundId: requiredString(body, 'roundId'),
      playerId: requiredString(body, 'playerId'),
      playerSecret: requiredString(body, 'playerSecret'),
    };
  }
  if (body.action === 'rewarded-ad-status') {
    return {
      action: 'rewarded-ad-status',
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
  throw new StructuredError(
    'invalid_action',
    "action must be 'start', 'status', 'reveal-status', 'request-rewarded-ad-correlation', 'rewarded-ad-status', or 'sweep'.",
    400,
  );
}

function generateRewardedAdCorrelationToken(): string {
  const bytes = new Uint8Array(REWARDED_AD_CORRELATION_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Issues a short-lived, single-use opaque token binding this exact
 * (game, round, winning submission, winner player) before any ad is shown.
 * The plaintext token is returned to the caller exactly once and is never
 * stored anywhere -- issue_rewarded_ad_correlation hashes it server-side
 * (extensions.digest, same pattern as player_credentials) before the insert.
 * Callers must already have verified playerSecret ownership and room
 * membership/winner-readiness before calling this.
 */
export async function issueRewardedAdCorrelation(
  // deno-lint-ignore no-explicit-any
  admin: any,
  params: {
    gameId: string;
    roundId: string;
    roundSubmissionId: string;
    winnerPlayerId: string;
    requestedByPlayerId: string;
  },
): Promise<{ token: string; expiresInSeconds: number }> {
  const token = generateRewardedAdCorrelationToken();
  const { error } = await admin.rpc('issue_rewarded_ad_correlation', {
    p_game_id: params.gameId,
    p_round_id: params.roundId,
    p_round_submission_id: params.roundSubmissionId,
    p_winner_player_id: params.winnerPlayerId,
    p_requested_by_player_id: params.requestedByPlayerId,
    p_token: token,
    p_ttl_seconds: REWARDED_AD_CORRELATION_TTL_SECONDS,
  });
  if (error) throw new StructuredError('db_error', 'Rewarded ad correlation could not be issued.', 500);
  return { token, expiresInSeconds: REWARDED_AD_CORRELATION_TTL_SECONDS };
}
