import { FakeAnimationProvider } from './FakeAnimationProvider';
import type { AnimationProvider } from './AnimationProvider';

export const animationService: AnimationProvider = new FakeAnimationProvider();

export type {
  AnimationProvider,
  AnimationInput,
  AnimationJob,
  AnimationJobStatus,
  AnimationJobState,
  MotionName,
} from './AnimationProvider';
