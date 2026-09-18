export type RewardedAdResult =
  | { status: 'earned' }
  | { status: 'closed_without_reward' }
  | { status: 'unavailable' }
  | { status: 'error'; message?: string };

export type RewardedAdPreparationResult =
  | { status: 'ready' }
  | { status: 'unavailable' }
  | { status: 'error' };

export interface RewardedAdSsvCorrelation {
  /** Opaque server-issued value only. Never pass player credentials here. */
  opaqueUserId?: string;
  /** Opaque server-issued value only. Never pass player credentials here. */
  opaqueCustomData?: string;
}

export interface RewardedAdProvider {
  prepare(correlation?: RewardedAdSsvCorrelation): Promise<RewardedAdPreparationResult>;
  show(correlation?: RewardedAdSsvCorrelation): Promise<RewardedAdResult>;
}
