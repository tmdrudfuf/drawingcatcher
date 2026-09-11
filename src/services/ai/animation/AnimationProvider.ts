import type { SketchVariant } from '@/types/game';

export type MotionName = 'bounce' | 'waddle' | 'blink' | 'tailWag' | 'stumble';

export type AnimationJobState = 'queued' | 'processing' | 'completed' | 'failed';

export interface AnimationInput {
  characterAsset: SketchVariant;
  /** Motions the backend picked from the sketch's traits. */
  requestedMotions?: MotionName[];
}

export interface AnimationJob {
  jobId: string;
  state: AnimationJobState;
}

export interface AnimationJobStatus {
  jobId: string;
  state: AnimationJobState;
  /**
   * Present when state === 'completed'. Milestone 1 produces no video — the
   * result describes client-side motion the Reveal screen plays on the doodle.
   */
  result?: {
    kind: 'client-motion';
    characterAsset: SketchVariant;
    motions: MotionName[];
  };
}

/**
 * Provider boundary. Real implementations later: VeoAnimationProvider,
 * RunwayAnimationProvider. Video generation is asynchronous, so the interface is
 * a job you start and then poll (docs/TECH_STACK.md §12).
 */
export interface AnimationProvider {
  animate(input: AnimationInput): Promise<AnimationJob>;
  getStatus(jobId: string): Promise<AnimationJobStatus>;
}
