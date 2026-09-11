import { delay } from '@/utils/delay';
import type {
  AnimationInput,
  AnimationJob,
  AnimationJobStatus,
  AnimationProvider,
  MotionName,
} from './AnimationProvider';

const DEFAULT_MOTIONS: MotionName[] = ['bounce', 'waddle', 'blink', 'tailWag'];

interface JobRecord {
  characterAsset: AnimationInput['characterAsset'];
  motions: MotionName[];
  startedAt: number;
}

/**
 * Milestone 1 stand-in. Simulates an async render job: `animate` returns a
 * processing job, `getStatus` reports `processing` until `processingMs` has
 * elapsed, then `completed` with a client-motion descriptor (no video).
 */
export class FakeAnimationProvider implements AnimationProvider {
  private jobs = new Map<string, JobRecord>();

  /** How long the fake render takes before getStatus reports completed. */
  processingMs = 2400;

  async animate(input: AnimationInput): Promise<AnimationJob> {
    await delay(400);
    const jobId = `fake-anim-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    this.jobs.set(jobId, {
      characterAsset: input.characterAsset,
      motions: input.requestedMotions?.length ? input.requestedMotions : DEFAULT_MOTIONS,
      startedAt: Date.now(),
    });
    return { jobId, state: 'processing' };
  }

  async getStatus(jobId: string): Promise<AnimationJobStatus> {
    const job = this.jobs.get(jobId);
    if (!job) return { jobId, state: 'failed' };
    if (Date.now() - job.startedAt < this.processingMs) {
      return { jobId, state: 'processing' };
    }
    return {
      jobId,
      state: 'completed',
      result: { kind: 'client-motion', characterAsset: job.characterAsset, motions: job.motions },
    };
  }
}
