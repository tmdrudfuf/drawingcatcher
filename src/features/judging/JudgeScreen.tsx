import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { CatDoodle } from '@/components/game/CatDoodle';
import { RemoteDrawing } from '@/components/game/RemoteDrawing';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { useGame } from '@/providers/game/GameProvider';
import { judgeService, type JudgeRoundInput, type JudgeRoundResult } from '@/services/ai/judge';
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

type JudgeOutcome = { status: 'success'; result: JudgeRoundResult } | { status: 'failed'; reason: string };

/**
 * Judging that never fabricates a result. Routes to Gemini when
 * `input.context` is present (remote game) via the shared `judgeService`
 * router, or the local fake provider otherwise (local/demo mode has no
 * server round to fail against, so this branch does not throw in practice).
 *
 * Trustworthy Core Step 1: a real Gemini/provider failure is reported
 * honestly as `status: 'failed'` and must never be silently replaced with a
 * fabricated JudgeRoundResult — the caller is responsible for showing an
 * honest failure state, not a placeholder verdict.
 */
async function judgeSafely(input: JudgeRoundInput, provider: 'gemini' | 'fake'): Promise<JudgeOutcome> {
  try {
    const result = await withTimeout(judgeService.judgeRound(input), JUDGE_TIMEOUT_MS);
    return { status: 'success', result };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    if (__DEV__) console.log('[judge] failed', reason);
    track('judge_failed', { provider, reason });
    return { status: 'failed', reason };
  }
}

export function JudgeScreen() {
  const { state, remoteRoom, isRemoteGame, localPlayerId, localDrawingUri, reportJudgeResult, endGame } = useGame();
  const [cues, setCues] = useState<string[]>([]);
  const [shown, setShown] = useState(0);
  const [cuesDone, setCuesDone] = useState(false);
  // Only this device's own attempt outcome -- never set from an effect
  // reacting to remoteRoom, so it can never race a real local success (see
  // `failure` below, which is the value actually rendered).
  const [localFailure, setLocalFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resultRef = useRef<JudgeRoundResult | null>(null);
  const doneRef = useRef(false);
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (remoteRoom?.status === 'ended') router.replace('/');
  }, [remoteRoom?.status]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Server-authoritative: reflects the real judge-round outcome shared by
  // both devices via realtime, independent of whether THIS device made the
  // call that produced it. Derived at render time (never written from an
  // effect body), and superseded the instant this device has its own real
  // success (see `failure` below) so a Retry can never be shadowed by a
  // stale remote snapshot from before the retry landed.
  const remoteFailureReason =
    isRemoteGame && remoteRoom?.judgeStatus === 'failed' ? remoteRoom.judgeError ?? 'AI judging failed.' : null;
  const failure = cues.length > 0 ? null : localFailure ?? remoteFailureReason;

  const runJudge = () => {
    if (state.roundNumber === 0) return;
    cancelledRef.current = false;
    setBusy(true);
    setLocalFailure(null);
    setCues([]);
    setShown(0);
    setCuesDone(false);
    doneRef.current = false;

    const provider: 'gemini' | 'fake' = isRemoteGame ? 'gemini' : 'fake';
    track('judge_started', { round: state.roundNumber, provider });

    const context =
      isRemoteGame && remoteRoom?.currentRoundId
        ? { gameId: remoteRoom.gameId, roundId: remoteRoom.currentRoundId }
        : undefined;

    judgeSafely({ prompt: state.prompt, drawings: state.players.map((p) => p.drawing), context }, provider).then(
      (outcome) => {
        if (cancelledRef.current) return;
        setBusy(false);
        if (outcome.status === 'failed') {
          // For the real remote path, judge-round has already persisted this
          // failure server-side (judge_status = 'failed'), so remoteRoom will
          // also observe it via realtime and `failure` above already covers
          // it. Setting localFailure here too is what surfaces a pure
          // client/network failure honestly — one that never reached the
          // server at all, and so never touched the DB.
          setLocalFailure(outcome.reason);
          return;
        }
        resultRef.current = outcome.result;
        setCues(outcome.result.suspenseCues);
        track('judge_completed', { round: state.roundNumber, provider });
      },
    );
  };

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

    // Trustworthy Core Step 1: reloading onto a round that is already known
    // to have failed must not silently trigger another real Gemini call —
    // judge-round's claim logic *would* allow reclaiming a 'failed' row, so
    // an automatic call here would be a real (billed) retry the player never
    // asked for. Only an explicit Retry press may do that (see runJudge).
    if (isRemoteGame && remoteRoom?.judgeStatus === 'failed') {
      // `failure` (derived above from remoteRoom) already reflects this on
      // its own -- nothing to set, and definitely no automatic Gemini call.
      return;
    }

    // Deferred a tick so the state updates inside runJudge (busy/cues/etc.)
    // happen outside this effect's own synchronous commit, not because the
    // timing matters here (nothing else races it before its own microtask
    // runs) -- react-hooks/set-state-in-effect otherwise flags the direct
    // call, same as the eslint-disable above documents for its own rule.
    queueMicrotask(runJudge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundNumber]);

  useEffect(() => {
    if (isRemoteGame && cuesDone && state.phase === 'results') router.replace('/results');
  }, [isRemoteGame, cuesDone, state.phase]);

  useEffect(() => {
    if (failure || cues.length === 0) return;
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
      // rounds.status server-side (inside judgeSafely, above); the cuesDone
      // effect above now takes over once realtime delivers that phase
      // change — this just makes sure the suspense animation always
      // finishes locally first, regardless of which order those two things
      // happen in.
    }, 900);
    return () => clearTimeout(t);
  }, [cues, failure, isRemoteGame, reportJudgeResult, shown]);

  const calculating = !failure && cues.length > 0 && shown >= cues.length;

  if (failure) {
    return (
      <Screen>
        <Text style={{ fontSize: 17, fontWeight: '800', textTransform: 'uppercase', color: colors.ink }}>
          AI Judge
        </Text>

        <View style={{ flex: 1 }} />

        <Card style={{ gap: 10, alignItems: 'center' }}>
          <Text style={{ fontSize: 20, fontWeight: '800', textAlign: 'center', color: colors.ink }}>
            AI couldn&apos;t judge this round.
          </Text>
          <Text style={{ fontSize: 14, textAlign: 'center', color: colors.sub }}>
            Your drawings are safe. Try judging again.
          </Text>
        </Card>

        <View style={{ gap: 10 }}>
          <Button label={busy ? 'RETRYING…' : 'RETRY'} disabled={busy} onPress={runJudge} />
          <Button label="EXIT TO HOME" variant="ghost" disabled={busy} onPress={() => endGame()} />
        </View>

        <View style={{ flex: 1 }} />
      </Screen>
    );
  }

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
