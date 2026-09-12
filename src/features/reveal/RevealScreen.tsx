import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Image, Platform, Text, useWindowDimensions, View } from 'react-native';

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
import { publicCharacterizedUrl, resolveDrawingUri } from '@/services/drawing/drawingAssets';
import { colors, radius } from '@/theme';
import type { PlayerId } from '@/types/game';

type Phase = 'working' | 'ready' | 'failed';

// AI providers (fake or real) must never trap the player. Each stage gets its
// own bound so one slow/failed call can't stall the whole reveal, plus an
// overall safety net. CHARACTERIZE_TIMEOUT_MS is sized for a real Gemini call
// (Milestone 4A), comfortably above the Edge Function's own 25s Gemini fetch
// timeout so a slow-but-successful generation still gets relayed back instead
// of the client giving up first.
const CHARACTERIZE_TIMEOUT_MS = 30_000;
const ANIMATE_START_TIMEOUT_MS = 3000;
const REVEAL_SAFETY_TIMEOUT_MS = 35_000;

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
    styleNote: 'fallback — real characterization unavailable',
    characterizedImagePath: null,
  };
}

/**
 * Characterization that always resolves. Routes to Gemini when `input.context`
 * is present (remote game) or the local fake provider otherwise, via the
 * shared `characterizationService` router — this function doesn't know or
 * care which one ran. On timeout/error it falls back to a result built purely
 * from `sketchVariant`/`traits`, never from the uploaded PNG's content, so a
 * Gemini outage degrades gracefully instead of trapping the player.
 */
async function characterizeSafely(
  input: CharacterizationInput,
  meta: { round: number; playerSlot: number },
): Promise<CharacterizationResult> {
  const provider = input.context ? 'gemini' : 'fake';
  try {
    return await withTimeout(characterizationService.characterize(input), CHARACTERIZE_TIMEOUT_MS);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    if (__DEV__) console.log('[characterization] failed', reason);
    track('characterization_failed', { round: meta.round, playerSlot: meta.playerSlot, provider, reason });
    return fallbackCharacterization(input);
  }
}

/**
 * Milestone 4A hero. Real video generation doesn't exist yet, so the real
 * Gemini character gets a lightweight in-app motion instead of sitting still
 * — a gentle bounce/wiggle/breathe, not a claim that this is generated video.
 * Self-contained (own Animated.Value, own loop), same pattern as MotionCat,
 * but kept local to this screen rather than touching MotionCat.tsx — that
 * component is shared with NextRoundScreen/JudgeScreen and always wraps a
 * local CatDoodle, not an arbitrary image.
 *
 * Renders its own <Image> (not the shared RemoteDrawing) because this is now
 * a rectangle sized independently on width AND height to match the hero
 * frame's real proportions — RemoteDrawing's API is deliberately square-only
 * for its other callers (the small reference thumbnail, Judge, Results), and
 * this file may only change RevealScreen.tsx. Loading/error swallowing isn't
 * needed here: this only ever mounts once `realCharacterUri` is already a
 * known-good string.
 */
function CharacterReveal({ uri, width, height, label }: { uri: string; width: number; height: number; label: string }) {
  const [pulse] = useState(() => new Animated.Value(0));
  const useNativeDriver = Platform.OS !== 'web';
  const loadStartedAt = useRef(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, useNativeDriver]);

  const translateY = pulse.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const rotate = pulse.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });

  return (
    <Animated.View
      style={{
        width,
        height,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ translateY }, { rotate }, { scale }],
      }}
    >
      <Image
        source={{ uri }}
        style={{ width, height }}
        resizeMode="contain"
        accessibilityLabel={label}
        onLoadStart={() => {
          loadStartedAt.current = Date.now();
        }}
        onLoad={(e) => {
          const src = e.nativeEvent?.source;
          track('remote_drawing_loaded', {
            label,
            latencyMs: loadStartedAt.current ? Date.now() - loadStartedAt.current : null,
            pngWidth: src?.width ?? null,
            pngHeight: src?.height ?? null,
          });
        }}
      />
    </Animated.View>
  );
}

export function RevealScreen() {
  const { state, remoteRoom, isRemoteGame, localPlayerId, localDrawingUri, winner, reportCharacterizations, reportAnimation } =
    useGame();
  const [phase, setPhase] = useState<Phase>('working');
  const [motions, setMotions] = useState<MotionName[]>([]);
  const [replayKey, setReplayKey] = useState(0);
  const [winnerCharacterization, setWinnerCharacterization] = useState<CharacterizationResult | null>(null);
  const [heroBox, setHeroBox] = useState({ width: 0, height: 0 });
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
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

    // Remote games characterize only the winner — that's the only drawing
    // Reveal ever shows, and each real Gemini call costs money. Local/fake
    // mode is unchanged: it still characterizes both players.
    const targets = isRemoteGame ? [winner] : state.players;
    const provider = isRemoteGame ? 'gemini' : 'fake';
    const slotOf = (playerId: string) => state.players.findIndex((p) => p.id === playerId) + 1;

    (async () => {
      try {
        const characterizeStartedAt = Date.now();
        if (__DEV__) console.log('[characterization] started');
        track('characterization_started', { round: state.roundNumber, provider });
        // Always resolves (falls back per player) — never rejects Promise.all.
        const results = await Promise.all(
          targets.map((p) =>
            characterizeSafely(
              {
                prompt: state.prompt,
                drawing: p.drawing,
                context:
                  isRemoteGame && remoteRoom?.currentRoundId
                    ? { gameId: remoteRoom.gameId, roundId: remoteRoom.currentRoundId, playerId: p.id }
                    : undefined,
              },
              { round: state.roundNumber, playerSlot: slotOf(p.id) },
            ),
          ),
        );
        if (cancelled) return;
        if (__DEV__) console.log('[characterization] completed');
        const map: Partial<Record<PlayerId, CharacterizationResult>> = {};
        targets.forEach((p, i) => {
          map[p.id] = results[i];
        });
        reportCharacterizations(map);

        const winnerResult = map[winner.id] ?? null;
        setWinnerCharacterization(winnerResult);
        track('characterization_completed', {
          round: state.roundNumber,
          provider,
          durationMs: Date.now() - characterizeStartedAt,
          playerSlot: slotOf(winner.id),
          fallbackUsed: isRemoteGame ? !winnerResult?.characterizedImagePath : false,
        });

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
  // Milestone 4A: the real Gemini output, when characterization succeeded.
  const realCharacterUri = isRemoteGame
    ? publicCharacterizedUrl(winnerCharacterization?.characterizedImagePath)
    : null;

  // No content-width cap: the Reveal composition uses the full width Screen
  // gives it (Screen's own small fixed page padding is the only horizontal
  // gutter), so a tablet's hero frame is genuinely large rather than a
  // narrow phone-width column floating in the middle of the screen.

  // LAYER 1 — main character. Sized independently on width AND height from
  // the hero frame's own measured dimensions (`heroBox`, via onLayout on the
  // frame below) — a rectangle matching the frame's real proportions, never
  // forced into a square. No 380px-style cap; the only ceiling is a generous
  // safety net that should never actually bind on a phone or tablet.
  // useWindowDimensions only seeds a pre-layout estimate before the frame's
  // first onLayout fires, so there's no visible pop once the real
  // measurement lands.
  const HERO_WIDTH_FRACTION = 0.95; // requested 0.92-0.98
  const HERO_HEIGHT_FRACTION = 0.9; // requested 0.88-0.95
  const HERO_MIN_PX = 160;
  const HERO_ABS_MAX_PX = 2000;
  const fallbackHeroWidth = windowWidth * 0.86;
  const fallbackHeroHeight = windowHeight * 0.4;
  const heroWidth = Math.round(
    Math.min(
      Math.max((heroBox.width > 0 ? heroBox.width : fallbackHeroWidth) * HERO_WIDTH_FRACTION, HERO_MIN_PX),
      HERO_ABS_MAX_PX,
    ),
  );
  const heroHeight = Math.round(
    Math.min(
      Math.max((heroBox.height > 0 ? heroBox.height : fallbackHeroHeight) * HERO_HEIGHT_FRACTION, HERO_MIN_PX),
      HERO_ABS_MAX_PX,
    ),
  );
  // The fake/demo fallback (MotionCat/CatDoodle) only takes one square
  // `size` prop (shared components — out of scope to change here), so it
  // uses the smaller of the two hero dimensions rather than a rebuilt shape.
  const heroFallbackSize = Math.min(heroWidth, heroHeight);

  // LAYER 2 — original sketch overlay. A proportion of the FRAME's own
  // shorter side (not of heroWidth/heroHeight, which are no longer one
  // number), per the requested 22-28% range — large enough to be a real
  // picture-in-picture reference, guarded so it never competes with the hero.
  const REFERENCE_FRAME_FRACTION = 0.25;
  const REFERENCE_MIN_PX = 80;
  const REFERENCE_MAX_PX = 180;
  const frameShortSide =
    heroBox.width > 0 && heroBox.height > 0
      ? Math.min(heroBox.width, heroBox.height)
      : Math.min(fallbackHeroWidth, fallbackHeroHeight);
  const referenceSize = Math.round(
    Math.min(Math.max(frameShortSide * REFERENCE_FRAME_FRACTION, REFERENCE_MIN_PX), REFERENCE_MAX_PX),
  );
  // Responsive inset for both overlay corners — scales a little with the
  // reference itself rather than a single flat constant.
  const overlayInset = Math.round(Math.max(10, referenceSize * 0.12));
  const androidElevation = Platform.OS === 'android' ? 10 : undefined;

  const rightBadge =
    isRemoteGame && realCharacterUri ? (
      <Pill label="REAL CHARACTER" tone="green" />
    ) : __DEV__ && isRemoteGame ? (
      <View style={{ backgroundColor: 'rgba(255,248,242,0.92)', borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3 }}>
        <Text style={{ fontSize: 9, fontWeight: '800', color: '#B5651D' }}>FAKE TRANSFORM (dev)</Text>
      </View>
    ) : null;

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

          {/* Single bounded hero frame. position:'relative' + overflow:'hidden'
              is the containment: it clips anything inside it (the animated
              main character included) to this box, which is what actually
              keeps the hero from ever overlapping the traits/caption/buttons
              rendered *outside* this frame below. Everything inside is a
              layer within the SAME frame, not separate flex regions. */}
          <View
            onLayout={(e) => setHeroBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
            style={{
              flex: 1,
              width: '100%',
              position: 'relative',
              overflow: 'hidden',
              borderWidth: 2,
              borderStyle: 'dashed',
              borderColor: '#E0B596',
              borderRadius: radius.lg,
              backgroundColor: '#FFF8F2',
            }}
          >
            {/* Layer 1 (zIndex 1): main character, filling most of the frame,
                centered, behind both overlays. Real Gemini character whenever
                one exists; only falls back to the fake/demo animation when
                Gemini failed or hasn't produced anything for this round. */}
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1,
              }}
            >
              {realCharacterUri ? (
                <CharacterReveal
                  key={replayKey}
                  uri={realCharacterUri}
                  width={heroWidth}
                  height={heroHeight}
                  label={`${winner.id}-characterized`}
                />
              ) : phase === 'ready' ? (
                <MotionCat key={replayKey} variant={v} size={heroFallbackSize} motions={motions} />
              ) : (
                <CatDoodle variant={v} characterized size={heroFallbackSize} />
              )}
            </View>

            {/* Layer 2 (zIndex 10): original sketch, picture-in-picture,
                upper-left, overlaid above the main character. Inset from the
                frame's edges so overflow:'hidden' above never clips it. */}
            <View
              style={{
                position: 'absolute',
                top: overlayInset,
                left: overlayInset,
                alignItems: 'center',
                zIndex: 10,
                elevation: androidElevation,
              }}
            >
              <View
                style={{
                  backgroundColor: 'rgba(255,248,242,0.92)',
                  borderRadius: radius.sm,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  marginBottom: 2,
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: colors.faint }}>
                  ORIGINAL SKETCH
                </Text>
              </View>
              {isRemoteGame ? (
                <RemoteDrawing uri={winnerSketchUri} size={referenceSize} label={winner.id} />
              ) : (
                <CatDoodle variant={v} size={referenceSize} />
              )}
            </View>

            {/* Layer 3 (zIndex 10): badge / dev label, upper-right, also
                above the main character. */}
            {rightBadge ? (
              <View
                style={{
                  position: 'absolute',
                  top: overlayInset,
                  right: overlayInset,
                  zIndex: 10,
                  elevation: androidElevation,
                }}
              >
                {rightBadge}
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {winner.drawing.traits.map((t) => (
              <Pill key={t} label={t} />
            ))}
          </View>

          <Text style={{ textAlign: 'center', color: colors.sub, fontSize: 13 }}>
            {realCharacterUri
              ? '✨ your sketch, transformed by Gemini'
              : phase === 'failed'
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
