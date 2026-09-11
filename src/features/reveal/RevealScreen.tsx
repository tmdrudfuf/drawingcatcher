import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { CatDoodle } from '@/components/game/CatDoodle';
import { MotionCat } from '@/components/game/MotionCat';
import { RemoteDrawing } from '@/components/game/RemoteDrawing';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { Screen } from '@/components/ui/Screen';
import { useGame } from '@/providers/game/GameProvider';
import {
  animationService,
  type AnimationJob,
  type AnimationJobStatus,
  type MotionName,
} from '@/services/ai/animation';
import {
  characterizationService,
  type CharacterizationInput,
  type CharacterizationResult,
} from '@/services/ai/characterization';
import { track } from '@/services/analytics/analytics';
import { resolveDrawingUri } from '@/services/drawing/drawingAssets';
import { colors, radius } from '@/theme';
import type { PlayerId } from '@/types/game';

type Phase = 'working' | 'ready' | 'failed';

// Fake providers must never trap the player. Each stage gets its own bound so
// one slow/failed call can't stall the whole reveal, plus an overall safety net.
const CHARACTERIZE_TIMEOUT_MS = 3000;
const ANIMATE_START_TIMEOUT_MS = 3000;
const REVEAL_SAFETY_TIMEOUT_MS = 8000;

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

/** Same shape FakeCharacterizationProvider returns — used only if it fails or hangs. */
function fallbackCharacterization(input: CharacterizationInput): CharacterizationResult {
  return {
    sourceSketchVariant: input.drawing.sketchVariant,
    characterAsset: input.drawing.sketchVariant,
    preservedTraits: input.drawing.traits,
    styleNote: 'fallback — fake characterization unavailable',
  };
}

/** Characterization that always resolves. Depends only on sketchVariant/traits — never on the uploaded PNG's content. */
async function characterizeSafely(input: CharacterizationInput): Promise<CharacterizationResult> {
  try {
    return await withTimeout(characterizationService.characterize(input), CHARACTERIZE_TIMEOUT_MS);
  } catch (err) {
    if (__DEV__) console.log('[characterization] failed', err instanceof Error ? err.message : err);
    return fallbackCharacterization(input);
  }
}

export function RevealScreen() {
  const { state, remoteRoom, isRemoteGame, localPlayerId, localDrawingUri, winner, reportCharacterizations, reportAnimation } =
    useGame();
  const [phase, setPhase] = useState<Phase>('working');
  const [motions, setMotions] = useState<MotionName[]>([]);
  const [replayKey, setReplayKey] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (remoteRoom?.status === 'ended') router.replace('/');
  }, [remoteRoom?.status]);

  useEffect(() => {
    if (!state.judgeResult || !winner) {
      router.replace('/');
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | undefined;
    let safetyId: ReturnType<typeof setTimeout> | undefined;

    const finishFailed = (stage: 'characterization' | 'animation', reason: string) => {
      if (cancelled) return;
      cancelled = true;
      if (pollId) clearInterval(pollId);
      if (safetyId) clearTimeout(safetyId);
      if (__DEV__) console.log('[animation] fallback', { stage, reason });
      reportAnimation({ state: 'failed', motions: [] });
      track('generation_failed', { stage, reason });
      setPhase('failed');
    };

    // Belt-and-suspenders: even an unforeseen hang in either fake provider must
    // not leave the player stuck on "working" forever.
    safetyId = setTimeout(() => finishFailed('animation', 'reveal-timeout'), REVEAL_SAFETY_TIMEOUT_MS);

    (async () => {
      try {
        if (__DEV__) console.log('[characterization] started');
        track('characterization_started');
        // Always resolves (falls back per player) — never rejects Promise.all.
        const results = await Promise.all(
          state.players.map((p) => characterizeSafely({ prompt: state.prompt, drawing: p.drawing })),
        );
        if (cancelled) return;
        if (__DEV__) console.log('[characterization] completed');
        const map: Partial<Record<PlayerId, CharacterizationResult>> = {};
        state.players.forEach((p, i) => {
          map[p.id] = results[i];
        });
        reportCharacterizations(map);

        if (__DEV__) console.log('[animation] started');
        track('animation_started');
        let job: AnimationJob;
        try {
          job = await withTimeout(
            animationService.animate({ characterAsset: winner.drawing.sketchVariant }),
            ANIMATE_START_TIMEOUT_MS,
          );
        } catch (err) {
          finishFailed('animation', err instanceof Error ? err.message : 'animate-failed');
          return;
        }
        if (cancelled) return;

        pollId = setInterval(async () => {
          let status: AnimationJobStatus;
          try {
            status = await animationService.getStatus(job.jobId);
          } catch (err) {
            finishFailed('animation', err instanceof Error ? err.message : 'status-failed');
            return;
          }
          if (cancelled) return;
          if (status.state === 'completed' && status.result) {
            cancelled = true;
            if (pollId) clearInterval(pollId);
            if (safetyId) clearTimeout(safetyId);
            setMotions(status.result.motions);
            setPhase('ready');
            reportAnimation({ state: 'completed', motions: status.result.motions });
            if (__DEV__) console.log('[animation] completed');
            track('animation_completed');
            track('animation_viewed');
          } else if (status.state === 'failed') {
            finishFailed('animation', 'job-failed');
          }
        }, 500);
      } catch (err) {
        // No stage should throw past characterizeSafely, but guard the whole
        // chain anyway so nothing is ever silently swallowed.
        finishFailed('characterization', err instanceof Error ? err.message : 'unknown');
      }
    })();

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      if (safetyId) clearTimeout(safetyId);
    };
    // Deliberately curated, primitive-only deps. GameProvider hands out a new
    // judgeResult/winner OBJECT on every realtime snapshot (even unrelated
    // ones), including the results->reveal transition this screen itself
    // triggers. Depending on those objects re-ran this effect mid-flight, the
    // cleanup cancelled the in-flight fake pipeline, and the one-shot
    // startedRef guard then blocked it from ever restarting — the screen hung
    // on "working" forever. round/winner identity is stable for the life of a
    // single reveal, so that's what this effect actually needs to react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundNumber, winner?.id]);

  if (!winner) return <Screen />;

  const v = winner.drawing.sketchVariant;
  const working = phase === 'working';
  const winnerSketchUri = isRemoteGame
    ? resolveDrawingUri(winner.drawing, winner.id === localPlayerId, localDrawingUri)
    : null;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 17, fontWeight: '800', textTransform: 'uppercase', color: colors.ink }}>
          Animated Reveal
        </Text>
        <Pill label="★ the payoff" tone="yellow" />
      </View>

      {working ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <MotionCat variant={v} size={150} motions={['bounce']} />
          <Text style={{ fontSize: 15, color: colors.sub }}>Bringing your drawings to life…</Text>
        </View>
      ) : (
        <>
          <Text
            style={{
              fontSize: 24,
              fontWeight: '900',
              color: colors.coralInk,
              textAlign: 'center',
              lineHeight: 27,
            }}
          >
            THAT weird drawing{'\n'}is now alive.
          </Text>

          <View
            style={{
              flex: 1,
              borderWidth: 2,
              borderStyle: 'dashed',
              borderColor: '#E0B596',
              borderRadius: radius.lg,
              backgroundColor: '#FFF8F2',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View style={{ position: 'absolute', left: 10, top: 8, alignItems: 'center' }}>
              <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: colors.faint }}>
                ORIGINAL SKETCH
              </Text>
              {isRemoteGame ? (
                <RemoteDrawing uri={winnerSketchUri} size={58} label={winner.id} />
              ) : (
                <CatDoodle variant={v} size={58} />
              )}
            </View>

            {__DEV__ && isRemoteGame ? (
              <Text
                style={{
                  position: 'absolute',
                  right: 10,
                  top: 8,
                  fontSize: 9,
                  fontWeight: '800',
                  color: '#B5651D',
                }}
              >
                FAKE TRANSFORM (dev)
              </Text>
            ) : null}

            {phase === 'ready' ? (
              <MotionCat key={replayKey} variant={v} size={210} motions={motions} />
            ) : (
              <CatDoodle variant={v} characterized size={210} />
            )}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {winner.drawing.traits.map((t) => (
              <Pill key={t} label={t} />
            ))}
          </View>

          <Text style={{ textAlign: 'center', color: colors.sub, fontSize: 13 }}>
            {phase === 'failed'
              ? 'couldn’t animate this one — here’s your character'
              : `▶ short loop · ${motions.join(' · ')}`}
          </Text>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              style={{ flex: 1 }}
              variant="ghost"
              label="REPLAY"
              onPress={() => setReplayKey((k) => k + 1)}
            />
            <Button
              style={{ flex: 1 }}
              variant="ghost"
              label="SHARE"
              onPress={() => Alert.alert('Share', 'Sharing is stubbed for Milestone 1.')}
            />
          </View>
        </>
      )}

      <Button
        label="CONTINUE"
        size="lg"
        disabled={working}
        onPress={() => router.replace('/next-round')}
      />
    </Screen>
  );
}
