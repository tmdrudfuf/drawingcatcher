import { FakeJudgeProvider } from './FakeJudgeProvider';
import { GeminiJudgeProvider } from './GeminiJudgeProvider';
import type { JudgeProvider, JudgeRoundInput, JudgeRoundResult } from './JudgeProvider';

const fakeProvider = new FakeJudgeProvider();
const geminiProvider = new GeminiJudgeProvider();

/**
 * Routes to the real Gemini-backed provider when the caller supplies Supabase
 * game/round context, and to the local fake provider otherwise. Screens
 * depend only on this router and the shared interface — never on Gemini or
 * the Edge Function directly.
 */
class JudgeRouter implements JudgeProvider {
  judgeRound(input: JudgeRoundInput): Promise<JudgeRoundResult> {
    return input.context ? geminiProvider.judgeRound(input) : fakeProvider.judgeRound(input);
  }
}

export const judgeService: JudgeProvider = new JudgeRouter();

export type {
  JudgeContext,
  JudgeProvider,
  JudgeRoundInput,
  JudgeRoundResult,
  JudgePlayerResult,
} from './JudgeProvider';
