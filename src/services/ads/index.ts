import { GoogleRewardedAdProvider } from './GoogleRewardedAdProvider';
import type { RewardedAdProvider } from './RewardedAdProvider';

export const rewardedAdProvider: RewardedAdProvider = new GoogleRewardedAdProvider();

export type {
  RewardedAdPreparationResult,
  RewardedAdProvider,
  RewardedAdResult,
  RewardedAdSsvCorrelation,
} from './RewardedAdProvider';

export {
  getRewardedAdCorrelation,
  type RewardedAdCorrelationInput,
  type RewardedAdCorrelationResult,
} from './rewardedAdCorrelation';

export {
  getRewardedAdStatus,
  type RewardedAdStatusInput,
  type RewardedAdStatusResult,
} from './rewardedAdStatus';
