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
  type CharacterizationStyle,
} from '@/services/ai/characterization';
import { rewardedAdProvider, type RewardedAdResult, type RewardedAdSsvCorrelation } from '@/services/ads';
import { track } from '@/services/analytics/analytics';
import { publicCharacterizedUrl, resolveDrawingUri } from '@/services/drawing/drawingAssets';
import { colors, radius } from '@/theme';
import type { PlayerId } from '@/types/game';
import { WinnerAnimationVideo } from './WinnerAnimationVideo';

type Phase = 'working' | 'ready' | 'failed';
type RevealStep = 'choice' | 'characterizing' | 'characterized';
// M4E step 3: 'verifying'/'verified' extend the base show() outcomes with
// the post-EARNED_REWARD SSV verification observation state
// (ad_ready/idle -> requesting -> earned -> verifying -> verified). Google
// SSV -- never this client -- is what actually grants the entitlement;
// these two states only ever reflect a READ of that server-side outcome.
type RewardedAdUiState = 'idle' | 'requesting' | RewardedAdResult['status'] | 'verifying' | 'verified';

// M4E step 4: the real-Veo generation sub-flow, entered only after
// rewarded-ad-status has independently confirmed verified=true AND the
// winner has explicitly pressed "GENERATE ANIMATION". This is a SEPARATE
// state machine from `phase`/`AnimationJobStatus` above, which drive the
// unrelated free/fake Characterize path (Milestone 1's local bounce/wiggle
// demo) -- the two never interact, so Characterize keeps working exactly as
// before regardless of anything below.
//   idle -> requesting -> processing -> completed
//                       \-> failed | ambiguous
//   idle -> requesting -> error (start() itself rejected, e.g. a lost
//     entitlement race -- no job/paid claim exists yet, so re-pressing is
//     safe and IS allowed; 'failed'/'ambiguous' mean a job DOES exist in a
//     terminal state and must never be retried from the client, per the
//     M4C one-shot paid-generation invariant)
type RealAnimationState = 'idle' | 'requesting' | 'processing' | 'completed' | 'failed' | 'ambiguous' | 'error';
const ANIMATION_STATUS_POLL_MS = 5000;

/**
 * Characterization V2.1 Reveal cleanup: replaces the old fixed "REAL
 * CHARACTER" badge with the real, server-selected style whenever one is
 * known. A pre-V2 completed characterization legitimately returns
 * `style: null` (see CharacterizationResult.style) -- that is not an
 * error, and must render exactly like today's "REAL CHARACTER" badge
 * rather than showing something broken or regenerating anything.
 */
const STYLE_BADGE_LABEL: Record<CharacterizationStyle, string> = {
  cute: '✨ CUTE',
  funny: '😂 FUNNY',
  epic: '🔥 EPIC',
  chibi: '🎀 CHIBI',
  realistic: '📷 REALISTIC',
  anime: '🎌 ANIME',
  pixel_art: '🎮 PIXEL ART',
  crayon: '🖍️ CRAYON',
};

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
  const {
    state,
    remoteRoom,
    isRemoteGame,
    localPlayerId,
    localDrawingUri,
    winner,
    reportCharacterizations,
    reportAnimation,
    getRewardedAdCorrelation,
    getRewardedAdStatus,
    getWinnerAnimationRevealStatus,
    startWinnerAnimation,
  } = useGame();
  const [revealStep, setRevealStep] = useState<RevealStep>('choice');
  const [rewardedAdState, setRewardedAdState] = useState<RewardedAdUiState>('idle');
  // M4E step 4: real-Veo generation state, entered only via the explicit
  // "GENERATE ANIMATION" press -- see RealAnimationState above.
  const [realAnimationState, setRealAnimationState] = useState<RealAnimationState>('idle');
  const [realAnimationError, setRealAnimationError] = useState<{ code: string; message: string } | null>(null);
  const [realVideoUrl, setRealVideoUrl] = useState<string | null>(null);
  // Server-issued, single-use SSV correlation token (see rewardedAdCorrelation.ts
  // and the M4E migration) -- fetched once per Reveal choice screen, BEFORE
  // the ad is requested, and passed to both prepare() and show() so
  // GoogleRewardedAdProvider's correlation-keyed session isn't thrown away
  // between the two calls (it keys the prepared ad on this exact value).
  const [adCorrelation, setAdCorrelation] = useState<RewardedAdSsvCorrelation | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('working');
  const [motions, setMotions] = useState<MotionName[]>([]);
  const [replayKey, setReplayKey] = useState(0);
  const [winnerCharacterization, setWinnerCharacterization] = useState<CharacterizationResult | null>(null);
  const [heroBox, setHeroBox] = useState({ width: 0, height: 0 });
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const startedRef = useRef(false);
  const choiceViewedRef = useRef(false);
  const mountedRef = useRef(true);
  // Guards the ad-correlation fetch below to run at most once per round --
  // see that effect's comment for why depending on getRewardedAdCorrelation
  // itself would be wrong.
  const adCorrelationRoundRef = useRef<string | null>(null);
  // Holds the ONE bounded delayed-verification timer (never a polling
  // interval) scheduled after EARNED_REWARD -- see checkRewardedAdVerification.
  const verificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (remoteRoom?.status === 'ended') router.replace('/');
  }, [remoteRoom?.status]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (verificationTimerRef.current) clearTimeout(verificationTimerRef.current);
  }, []);

  useEffect(() => {
    if (!winner || choiceViewedRef.current) return;
    choiceViewedRef.current = true;
    track('bring_to_life_choice_viewed');
  }, [winner]);

  useEffect(() => {
    if (revealStep !== 'choice') return;
    // getRewardedAdCorrelation is a useCallback keyed on [identity,
    // remoteRoom], and remoteRoom is a NEW object on every realtime
    // snapshot (same caveat the animation effect below documents at length
    // for judgeResult/winner). Depending on the callback's identity here
    // would re-mint a correlation -- and reload the ad from scratch via
    // prepare()'s correlationKey change -- on every snapshot while a player
    // sits on this screen. Guard on the round instead: a round has exactly
    // one winner/winning submission, so one correlation per round is
    // correct and sufficient.
    const roundKey = remoteRoom?.currentRoundId ?? null;
    if (adCorrelationRoundRef.current === roundKey) return;
    adCorrelationRoundRef.current = roundKey;

    let cancelled = false;
    (async () => {
      // Fetch the opaque SSV correlation BEFORE the ad is prepared/shown --
      // never trust a client-side EARNED_REWARD event as authorization (see
      // rewardedAdCorrelation.ts and the M4E migration). The same
      // correlation object is passed to both prepare() and show() below:
      // GoogleRewardedAdProvider keys its in-flight prepared ad on this
      // exact value, so passing it only at show() would key-mismatch,
      // discard the already-loading ad, and reload from scratch.
      const result = await getRewardedAdCorrelation();
      if (cancelled) return;
      const correlation: RewardedAdSsvCorrelation | undefined =
        result.status === 'ready' ? { opaqueCustomData: result.token } : undefined;
      setAdCorrelation(correlation);
      void rewardedAdProvider.prepare(correlation);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealStep, remoteRoom?.currentRoundId]);

  // M4E step 4: observes an in-flight/existing real animation job via the
  // EXISTING reveal-status recovery infrastructure -- this never starts or
  // retries generation itself, only reads. Gated on realAnimationState
  // (not revealStep), so it keeps observing even if the player has since
  // pressed Characterize -- the server-side job is unaffected either way,
  // this only controls whether THIS screen shows the outcome this visit.
  useEffect(() => {
    if (realAnimationState !== 'processing') return;
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | undefined;
    let announcedProcessing = false;

    const poll = async () => {
      const result = await getWinnerAnimationRevealStatus();
      if (cancelled) return;
      if (result.state === 'completed') {
        cancelled = true;
        if (pollId) clearInterval(pollId);
        setRealVideoUrl(result.videoUrl);
        setRealAnimationState('completed');
        track('animation_generation_completed');
        return;
      }
      if (result.state === 'failed' || result.state === 'ambiguous') {
        cancelled = true;
        if (pollId) clearInterval(pollId);
        setRealAnimationState(result.state);
        track('animation_generation_failed', { stage: 'provider', jobState: result.state });
        return;
      }
      if (result.state === 'processing' && !announcedProcessing) {
        announcedProcessing = true;
        track('animation_generation_processing', { jobStatus: result.jobStatus });
      }
      // 'not_requested'/'error' here would mean a transient status-read
      // hiccup right after a successful start -- never treated as failed;
      // the next tick simply tries again. The job itself, and the one-shot
      // paid-generation marker, are untouched by any of this.
    };

    void poll();
    pollId = setInterval(() => void poll(), ANIMATION_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
    };
    // getWinnerAnimationRevealStatus is a useCallback keyed on [identity,
    // remoteRoom] -- remoteRoom is a new object on every realtime snapshot
    // (same caveat documented at length on the animation effect below), so
    // depending on its identity here would restart this interval on every
    // snapshot instead of polling at a steady cadence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realAnimationState]);

  useEffect(() => {
    if (!state.judgeResult || !winner) {
      router.replace('/');
      return;
    }
    if (revealStep !== 'characterizing') return;
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
      setRevealStep('characterized');
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
            setRevealStep('characterized');
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
  }, [revealStep, state.roundNumber, winner?.id]);

  if (!winner) return <Screen />;

  const chooseCharacterize = () => {
    track('bring_to_life_characterize_selected');
    setRevealStep('characterizing');
  };

  // EARNED_REWARD is NEVER authoritative -- see RewardedAdProvider.ts and
  // the M4E migration. This only READS whether Google's SSV callback has
  // already verified and granted a rewarded_ad entitlement server-side; it
  // never inserts one, never calls a grant RPC, and never calls
  // animate-winner's 'start' action. One call per invocation, no loop.
  const checkRewardedAdVerification = async () => {
    // Guards against duplicate work AND duplicate rewarded_ad_verified
    // analytics: the bounded auto-check timer and the manual "CHECK
    // STATUS" button can otherwise both fire after verification already
    // succeeded (e.g. the user manually checked, then the 6s timer still
    // fires). Once verified, this is a no-op -- there is nothing further
    // to observe here, and generateRealAnimation below never re-checks it.
    if (!mountedRef.current || rewardedAdState === 'verified') return;
    setRewardedAdState('verifying');
    const result = await getRewardedAdStatus();
    if (!mountedRef.current) return;
    const verified = result.status === 'checked' && result.verified;
    setRewardedAdState(verified ? 'verified' : 'earned');
    if (verified) track('rewarded_ad_verified');
  };

  // M4E step 4: the ONLY place in the client that calls animate-winner's
  // 'start' action, and it only ever runs from this explicit press handler
  // -- never automatically from a rewardedAdState/realAnimationState
  // change. The server re-derives and re-validates the winner, winning
  // submission, entitlement, and one-shot paid claim; this sends only the
  // caller's own identity, never a submission id (see WinnerAnimationService.ts).
  const generateRealAnimation = async () => {
    if (realAnimationState !== 'idle' && realAnimationState !== 'error') return;
    track('animation_generation_requested');
    setRealAnimationError(null);
    setRealAnimationState('requesting');
    const result = await startWinnerAnimation();
    if (!mountedRef.current) return;
    if (result.state === 'error') {
      track('animation_generation_failed', { code: result.code, stage: 'start' });
      setRealAnimationError({ code: result.code, message: result.message });
      setRealAnimationState('error');
      return;
    }
    track('animation_generation_started', {
      jobStatus: result.jobStatus,
      paidGenerationRequestedThisCall: result.paidGenerationRequestedThisCall,
    });
    setRealAnimationState('processing');
  };

  const showRewardedAd = async () => {
    if (rewardedAdState === 'requesting' || rewardedAdState === 'earned' || rewardedAdState === 'verifying' || rewardedAdState === 'verified') {
      return;
    }
    track('bring_to_life_animate_selected');
    setRewardedAdState('requesting');
    const result = await rewardedAdProvider.show(adCorrelation);
    if (!mountedRef.current) return;
    setRewardedAdState(result.status);
    if (result.status === 'earned') {
      // ONE bounded delayed check, not a polling loop: Google's real SSV
      // callback typically lands within a few seconds of EARNED_REWARD.
      // The "CHECK STATUS" button below covers a slower callback without
      // this ever repeating on its own.
      verificationTimerRef.current = setTimeout(() => void checkRewardedAdVerification(), 6000);
    }
  };

  if (revealStep === 'choice') {
    return (
      <Screen>
        <Text style={{ fontSize: 17, fontWeight: '800', textTransform: 'uppercase', color: colors.ink }}>
          Bring Them to Life
        </Text>
        <Text style={{ textAlign: 'center', fontSize: 26, fontWeight: '900', color: colors.coralInk }}>
          What should happen to this wonderfully weird winner?
        </Text>

        <View style={{ gap: 12 }}>
          <View
            style={{
              gap: 10,
              padding: 16,
              borderWidth: 2,
              borderColor: colors.coral,
              borderRadius: radius.lg,
              backgroundColor: colors.coralTint,
            }}
          >
            <Pill label="FREE" tone="green" />
            <Text style={{ fontSize: 22, fontWeight: '900', color: colors.ink }}>Characterize</Text>
            <Text style={{ fontSize: 15, lineHeight: 21, color: colors.sub }}>
              Turn the winning sketch into an AI character while keeping all its weird proportions.
            </Text>
            <Button label="CHARACTERIZE" size="lg" onPress={chooseCharacterize} />
          </View>

          <View
            style={{
              gap: 10,
              padding: 16,
              borderWidth: 2,
              borderColor: '#E7C568',
              borderRadius: radius.lg,
              backgroundColor: colors.yellowTint,
            }}
          >
            <Pill label="ANIMATED" tone="yellow" />
            <Text style={{ fontSize: 22, fontWeight: '900', color: colors.ink }}>Animate</Text>
            <Text style={{ fontSize: 15, lineHeight: 21, color: colors.sub }}>
              Watch an ad to turn the character into a short animation shared with both players.
            </Text>
            <Button
              label="WATCH AD & ANIMATE"
              variant="ghost"
              size="lg"
              disabled={
                rewardedAdState === 'requesting' ||
                rewardedAdState === 'earned' ||
                rewardedAdState === 'verifying' ||
                rewardedAdState === 'verified'
              }
              onPress={() => void showRewardedAd()}
            />
            {rewardedAdState === 'requesting' ? (
              <Text style={{ fontSize: 14, lineHeight: 20, color: colors.sub }}>Opening Google’s test ad…</Text>
            ) : rewardedAdState === 'earned' ? (
              <>
                <Text style={{ fontSize: 14, lineHeight: 20, color: colors.green }}>
                  Reward received — verifying… No animation request was made.
                </Text>
                <Button label="CHECK STATUS" variant="link" onPress={() => void checkRewardedAdVerification()} />
              </>
            ) : rewardedAdState === 'verifying' ? (
              <Text style={{ fontSize: 14, lineHeight: 20, color: colors.green }}>
                Checking with the ad network…
              </Text>
            ) : rewardedAdState === 'verified' ? (
              <View style={{ gap: 10 }}>
                {localPlayerId !== winner.id ? (
                  // Only the round winner may press GENERATE ANIMATION --
                  // animate-winner's 'start' action requires the caller to
                  // BE the winner (verifyWinnerSubmission), matching who
                  // the entitlement was issued for. The non-winner still
                  // watched an ad and helped verify it, so this explains
                  // why there's no button for them rather than showing one
                  // that would deterministically fail.
                  <Text style={{ fontSize: 14, lineHeight: 20, color: colors.green }}>
                    Verified — {winner.name} can now generate the animation.
                  </Text>
                ) : realAnimationState === 'idle' ? (
                  <>
                    <Text style={{ fontSize: 14, lineHeight: 20, color: colors.green }}>
                      Verified — ready to bring it to life.
                    </Text>
                    <Button label="GENERATE ANIMATION" size="lg" onPress={() => void generateRealAnimation()} />
                  </>
                ) : realAnimationState === 'requesting' ? (
                  <Text style={{ fontSize: 14, lineHeight: 20, color: colors.sub }}>Starting animation…</Text>
                ) : realAnimationState === 'processing' ? (
                  <Text style={{ fontSize: 14, lineHeight: 20, color: colors.sub }}>
                    Generating your real animation… this can take a minute or two.
                  </Text>
                ) : realAnimationState === 'completed' && realVideoUrl ? (
                  <View style={{ alignItems: 'center', gap: 8 }}>
                    <WinnerAnimationVideo
                      uri={realVideoUrl}
                      width={Math.min(windowWidth - 64, 320)}
                      height={Math.min(windowWidth - 64, 320)}
                      onPlaybackFailed={() => track('winner_animation_video_playback_failed')}
                    />
                    <Text style={{ fontSize: 13, color: colors.sub }}>Your real animation is ready.</Text>
                  </View>
                ) : realAnimationState === 'failed' || realAnimationState === 'ambiguous' ? (
                  // Deliberately NO retry button here: a job already exists
                  // in a terminal bad state, and the M4C one-shot
                  // paid-generation guard must never be given a channel to
                  // attempt a second Veo create for it from this client.
                  <Text style={{ fontSize: 14, lineHeight: 20, color: colors.sub }}>
                    The animation could not be completed. Characterize and Continue are still available.
                  </Text>
                ) : realAnimationState === 'error' ? (
                  // No job/paid claim exists yet in this case (the start()
                  // call itself was rejected, e.g. a lost entitlement race)
                  // -- retrying is safe and is the correct recovery.
                  <>
                    <Text style={{ fontSize: 14, lineHeight: 20, color: colors.sub }}>
                      {realAnimationError?.message ?? 'Animation could not be started.'}
                    </Text>
                    <Button label="TRY AGAIN" variant="link" onPress={() => void generateRealAnimation()} />
                  </>
                ) : null}
              </View>
            ) : rewardedAdState === 'closed_without_reward' ? (
              <Text style={{ fontSize: 14, lineHeight: 20, color: colors.sub }}>
                No reward was earned. You can try again, Characterize, or continue.
              </Text>
            ) : rewardedAdState === 'unavailable' ? (
              <Text style={{ fontSize: 14, lineHeight: 20, color: colors.sub }}>
                Rewarded ads are unavailable here. Use a development build, or choose Characterize instead.
              </Text>
            ) : rewardedAdState === 'error' ? (
              <Text style={{ fontSize: 14, lineHeight: 20, color: colors.sub }}>
                The test ad could not be shown. Characterize and Continue are still available.
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ flex: 1 }} />
        <Button label="CONTINUE WITHOUT EFFECT" variant="link" onPress={() => router.replace('/next-round')} />
      </Screen>
    );
  }

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
      <Pill
        label={winnerCharacterization?.style ? STYLE_BADGE_LABEL[winnerCharacterization.style] : 'REAL CHARACTER'}
        tone="green"
      />
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
          <Text style={{ fontSize: 15, color: colors.sub }}>Bringing your drawing to life…</Text>
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
              keeps the hero from ever overlapping the caption/buttons
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
