import { FakeJudgeProvider } from './FakeJudgeProvider';
import type { JudgeProvider } from './JudgeProvider';

/**
 * The seam features import. Swapping to a real vendor (GeminiJudgeProvider, ...)
 * is a one-line change here; screens never import a provider directly.
 */
export const judgeService: JudgeProvider = new FakeJudgeProvider();

export type {
  JudgeProvider,
  JudgeRoundInput,
  JudgeRoundResult,
  JudgePlayerResult,
} from './JudgeProvider';
