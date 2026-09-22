import { supabase, supabaseConfigError } from '@/providers/supabase/supabase';

export interface WinnerAnimationRevealStatusInput {
  gameId: string;
  roundId: string;
  playerId: string;
  playerSecret: string;
}

interface WinnerAnimationRevealResultBase {
  paidGenerationRequestsThisInvocation: 0;
}

export type WinnerAnimationRevealResult =
  | (WinnerAnimationRevealResultBase & { state: 'not_requested' })
  | (WinnerAnimationRevealResultBase & {
      state: 'processing';
      jobId: string;
      jobStatus: string;
    })
  | (WinnerAnimationRevealResultBase & {
      state: 'completed';
      jobId: string;
      videoUrl: string;
      videoUrlExpiresInSeconds: number;
      videoContentType: 'video/mp4';
      videoContentLength: number;
      completedAt: string;
    })
  | (WinnerAnimationRevealResultBase & { state: 'failed'; jobId: string })
  | (WinnerAnimationRevealResultBase & { state: 'ambiguous'; jobId: string })
  | (WinnerAnimationRevealResultBase & {
      state: 'error';
      code: string;
      message: string;
    });

function errorResult(code: string, message: string): WinnerAnimationRevealResult {
  return { state: 'error', code, message, paidGenerationRequestsThisInvocation: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafePlaybackUrl(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function parseWinnerAnimationRevealResponse(value: unknown): WinnerAnimationRevealResult {
  if (!isRecord(value)) {
    return errorResult('invalid_response', 'Winner animation status returned an invalid response.');
  }
  if (value.paidGenerationRequestsThisInvocation !== 0) {
    return errorResult('invalid_response', 'Winner animation status returned an invalid request count.');
  }
  if (nonEmptyString(value.error)) {
    return errorResult(
      value.error,
      nonEmptyString(value.message) ? value.message : 'Winner animation status could not be loaded.',
    );
  }
  if (value.state === 'not_requested') {
    return { state: 'not_requested', paidGenerationRequestsThisInvocation: 0 };
  }
  if (!nonEmptyString(value.state) || !nonEmptyString(value.jobId)) {
    return errorResult('invalid_response', 'Winner animation status returned incomplete job data.');
  }
  if (value.state === 'completed') {
    if (
      !isSafePlaybackUrl(value.videoUrl) ||
      value.videoContentType !== 'video/mp4' ||
      typeof value.videoContentLength !== 'number' ||
      !Number.isFinite(value.videoContentLength) ||
      value.videoContentLength <= 0 ||
      typeof value.videoUrlExpiresInSeconds !== 'number' ||
      !Number.isFinite(value.videoUrlExpiresInSeconds) ||
      value.videoUrlExpiresInSeconds <= 0 ||
      !nonEmptyString(value.completedAt)
    ) {
      return errorResult('invalid_response', 'Winner animation status returned invalid video data.');
    }
    return {
      state: 'completed',
      jobId: value.jobId,
      videoUrl: value.videoUrl,
      videoUrlExpiresInSeconds: value.videoUrlExpiresInSeconds,
      videoContentType: 'video/mp4',
      videoContentLength: value.videoContentLength,
      completedAt: value.completedAt,
      paidGenerationRequestsThisInvocation: 0,
    };
  }
  if (value.state === 'failed' || value.state === 'ambiguous') {
    return { state: value.state, jobId: value.jobId, paidGenerationRequestsThisInvocation: 0 };
  }
  return {
    state: 'processing',
    jobId: value.jobId,
    jobStatus: value.state,
    paidGenerationRequestsThisInvocation: 0,
  };
}

export async function getWinnerAnimationRevealStatus(
  input: WinnerAnimationRevealStatusInput,
): Promise<WinnerAnimationRevealResult> {
  if (!supabase) {
    return errorResult('client_not_configured', supabaseConfigError ?? 'Supabase is not available.');
  }

  try {
    const { data, error } = await supabase.functions.invoke<unknown>('animate-winner', {
      body: {
        action: 'reveal-status',
        gameId: input.gameId,
        roundId: input.roundId,
        playerId: input.playerId,
        playerSecret: input.playerSecret,
      },
    });
    if (error) return errorResult('request_failed', 'Winner animation status could not be loaded.');
    return parseWinnerAnimationRevealResponse(data);
  } catch {
    return errorResult('request_failed', 'Winner animation status request failed.');
  }
}

/**
 * M4E step 4: the explicit "GENERATE ANIMATION" action. This is the ONLY
 * client call site for animate-winner's 'start' action -- it reuses the
 * existing M4C start path entirely (player credential verification, game
 * membership, winner/winning-submission derivation, entitlement
 * validation/consumption, job creation/reuse, the atomic one-shot paid-Veo
 * claim) rather than adding any new server endpoint. The server derives the
 * winner and its winning submission itself from (gameId, roundId, playerId)
 * -- this function has no submission-id parameter, so there is no channel
 * for a caller to choose or override which submission gets animated.
 */
export type WinnerAnimationStartResult =
  | { state: 'started'; jobId: string; jobStatus: string; paidGenerationRequestedThisCall: boolean }
  | { state: 'error'; code: string; message: string };

export function parseWinnerAnimationStartResponse(value: unknown): WinnerAnimationStartResult {
  if (!isRecord(value)) {
    return { state: 'error', code: 'invalid_response', message: 'Animation could not be started.' };
  }
  if (nonEmptyString(value.error)) {
    return {
      state: 'error',
      code: value.error,
      message: nonEmptyString(value.message) ? value.message : 'Animation could not be started.',
    };
  }
  if (value.verified !== true || !nonEmptyString(value.jobId) || !nonEmptyString(value.jobStatus)) {
    return { state: 'error', code: 'invalid_response', message: 'Animation start returned an incomplete response.' };
  }
  return {
    state: 'started',
    jobId: value.jobId,
    jobStatus: value.jobStatus,
    paidGenerationRequestedThisCall: value.paidGenerationRequestsThisInvocation === 1,
  };
}

export async function startWinnerAnimation(
  input: WinnerAnimationRevealStatusInput,
): Promise<WinnerAnimationStartResult> {
  if (!supabase) {
    return { state: 'error', code: 'client_not_configured', message: supabaseConfigError ?? 'Supabase is not available.' };
  }

  try {
    const { data, error } = await supabase.functions.invoke<unknown>('animate-winner', {
      body: {
        action: 'start',
        gameId: input.gameId,
        roundId: input.roundId,
        playerId: input.playerId,
        playerSecret: input.playerSecret,
      },
    });
    if (error) return { state: 'error', code: 'request_failed', message: 'Animation could not be started.' };
    return parseWinnerAnimationStartResponse(data);
  } catch {
    return { state: 'error', code: 'request_failed', message: 'Animation start request failed.' };
  }
}
