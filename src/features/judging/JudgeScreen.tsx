import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { CatDoodle } from '@/components/game/CatDoodle';
import { RemoteDrawing } from '@/components/game/RemoteDrawing';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { useGame } from '@/providers/game/GameProvider';
import { fakeJudgeService, judgeService, type JudgeRoundInput, type JudgeRoundResult } from '@/services/ai/judge';
import { track } from '@/services/analytics/analytics';
import { resolveDrawingUri } from '@/services/drawing/drawingAssets';
import { colors } from '@/theme';

// Mirrors RevealScreen's CHARACTERIZE_TIMEOUT_MS reasoning: comfortably above
// the judge-round Edge Function's own worst case (~25s Gemini timeout, or a
// waiting caller's own ~20s poll budget), so a slow-but-alive call still gets
// relayed back instead of the client giving up first. Duplicated here rather
// than shared/exported from RevealScreen.tsx, which is out of scope to touch.
const JUDGE_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Judging that always resolves. Routes to Gemini when `input.context` is
 * present (remote game) via the shared `judgeService` router, or the local
 * fake provider otherwise. On timeout/error (Gemini down, edge function
 * unreachable, malformed result) it falls back to the fake judge's result so
 * the round can still complete — real AI failure must never be the only path
 * to a result.
 */
async function judgeSafely(
  input: JudgeRoundInput,
  provider: 'gemini' | 'fake',
): Promise<{ result: JudgeRoundResult; usedFallback: boolean }> {
  try {
    const result = await withTimeout(judgeService.judgeRound(input), JUDGE_TIMEOUT_MS);
    return { result, usedFallback: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    if (__DEV__) console.log('[judge] failed, falling back to fake', reason);
    track('judge_failed', { provider, reason });
    track('judge_fallback_used', { reason });
    const result = await fakeJudgeService.judgeRound(input);
    return { result, usedFallback: true };
  }
}

export function JudgeScreen() {
  const {
    state,
    remoteRoom,
    isRemoteGame,
    localPlayerId,
    localDrawingUri,
    completeRemoteJudging,
    reportJudgeResult,
  } = useGame();
  const [cues, setCues] = useState<string[]>([]);
  const [shown, setShown] = useState(0);
  const [cuesDone, setCuesDone] = useState(false);
  const resultRef = useRef<JudgeRoundResult | null>(null);
  const doneRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (remoteRoom?.status === 'ended') router.replace('/');
  }, [remoteRoom?.status]);

  useEffect(() => {
    if (state.roundNumber === 0) {
      router.replace('/');
      return;
    }
    // One-shot, deliberately: re-running this on every remoteRoom/state
    // object churn was the exact bug fixed in RevealScreen (GameProvider
    // hands out new object references on every realtime tick). JudgeScreen
    // only reaches here once a round genuinely exists, so there's nothing to
    // legitimately wait for the way Reveal had to wait for `winner`.
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const provider: 'gemini' | 'fake' = isRemoteGame ? 'gemini' : 'fake';
    track('judge_started', { round: state.roundNumber, provider });

    const context =
      isRemoteGame && remoteRoom?.currentRoundId
        ? { gameId: remoteRoom.gameId, roundId: remoteRoom.currentRoundId }
        : undefined;

    judgeSafely({ prompt: state.prompt, drawings: state.players.map((p) => p.drawing), context }, provider).then(
      ({ result, usedFallback }) => {
        if (cancelled) return;
        resultRef.current = result;
        setCues(result.suspenseCues);
        track('judge_completed', { round: state.roundNumber, provider, usedFallback });

        if (isRemoteGame && usedFallback) {
          // Real judging failed or timed out. The Edge Function does NOT
          // advance rounds.status on failure (only on success), so this
          // client-side call is what makes the round progress instead of
          // both devices getting stuck on this screen. Idempotent — a
          // concurrent duplicate call from the other device is a no-op (the
          // RPC is guarded on rounds.status = 'judging').
          completeRemoteJudging();
        }
      },
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundNumber]);

  useEffect(() => {
    if (isRemoteGame && cuesDone && state.phase === 'results') router.replace('/results');
  }, [isRemoteGame, cuesDone, state.phase]);

  useEffect(() => {
    if (cues.length === 0) return;
    if (shown < cues.length) {
      const t = setTimeout(() => setShown((n) => n + 1), 620);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      if (doneRef.current || !resultRef.current) return;
      doneRef.current = true;
      setCuesDone(true);
      if (!isRemoteGame) {
        reportJudgeResult(resultRef.current);
        router.replace('/results');
      }
      // Remote: nothing left to do here. Success already advanced
      // rounds.status server-side (inside judgeSafely, above); failure
      // advanced it via completeRemoteJudging(). The cuesDone effect above
      // now takes over once realtime delivers that phase change — this just
      // makes sure the suspense animation always finishes locally first,
      // regardless of which order those two things happen in.
    }, 900);
    return () => clearTimeout(t);
  }, [cues, isRemoteGame, reportJudgeResult, shown]);

  const calculating = cues.length > 0 && shown >= cues.length;

  return (
    <Screen>
      <Text style={{ fontSize: 17, fontWeight: '800', textTransform: 'uppercase', color: colors.ink }}>
        AI Judge
      </Text>
      <Text style={{ fontSize: 22, fontWeight: '800', textAlign: 'center', color: colors.ink }}>
        AI is judging…
      </Text>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18 }}>
        {state.players.map((p, i) => (
          <View key={p.id} style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.faint }}>
              P{i + 1}
            </Text>
            {isRemoteGame ? (
              <RemoteDrawing
                uri={resolveDrawingUri(p.drawing, p.id === localPlayerId, localDrawingUri)}
                size={104}
                label={p.id}
              />
            ) : (
              <CatDoodle variant={p.drawing.sketchVariant} size={104} />
            )}
          </View>
        ))}
      </View>

      <Card style={{ borderStyle: 'dashed', borderColor: '#E0B596', backgroundColor: '#FFF8F2', gap: 10 }}>
        {cues.length === 0 ? (
          <Text style={{ color: colors.sub, fontSize: 13 }}>inspecting the drawings…</Text>
        ) : (
          cues.slice(0, shown).map((c) => (
            <Text key={c} style={{ fontWeight: '800', fontSize: 13, letterSpacing: 0.5, color: colors.ink }}>
              {c}
            </Text>
          ))
        )}
      </Card>

      <View style={{ flex: 1 }} />
      <Text
        style={{
          textAlign: 'center',
          fontSize: 15,
          fontWeight: '700',
          color: colors.sub,
          opacity: calculating ? 1 : 0,
        }}
      >
        CALCULATING SCORES…
      </Text>
    </Screen>
  );
}
