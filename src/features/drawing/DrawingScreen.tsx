import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { SketchCanvas, type SketchCanvasHandle } from '@/components/game/SketchCanvas';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useGame } from '@/providers/game/GameProvider';
import { track } from '@/services/analytics/analytics';
import { colors, timing } from '@/theme';

export function DrawingScreen() {
  const { state, remoteRoom, localPlayer, submitDrawings } = useGame();
  const [secondsLeft, setSecondsLeft] = useState<number>(timing.roundSeconds);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<SketchCanvasHandle>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (state.roundNumber === 0) router.replace('/');
    if (remoteRoom?.phase === 'judging') router.replace('/judge');
    if (remoteRoom?.phase === 'results') router.replace('/results');
    if (remoteRoom?.status === 'ended') router.replace('/');
  }, [remoteRoom?.phase, remoteRoom?.status, state.roundNumber]);

  const submit = async () => {
    if (submittedRef.current || busy) return;
    setBusy(true);

    // Local M1 game: no asset pipeline.
    if (!remoteRoom) {
      submittedRef.current = true;
      await submitDrawings();
      router.replace('/judge');
      return;
    }

    track('drawing_export_started', { round: state.roundNumber });
    const png = await canvasRef.current?.exportPng();
    if (!png) {
      track('generation_failed', { stage: 'drawing_export' });
      setBusy(false);
      Alert.alert('Could not capture your drawing', 'Please try Submit again — your drawing is still here.');
      return;
    }
    track('drawing_export_completed', { round: state.roundNumber, bytes: png.length });

    const ok = await submitDrawings(png);
    if (ok) {
      submittedRef.current = true;
    } else {
      // Upload / save failed — let the player retry without redrawing.
      setBusy(false);
      Alert.alert('Submit failed', 'We could not upload your drawing. Check your connection and try Submit again.');
    }
  };

  useEffect(() => {
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (secondsLeft === 0) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const low = secondsLeft <= 10;
  const submitted = Boolean(localPlayer?.submitted);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 17, fontWeight: '800', textTransform: 'uppercase', color: colors.ink }}>
          {state.prompt || 'Draw a cat'}
        </Text>
        <Text
          style={{
            fontSize: 16,
            fontWeight: '800',
            color: low ? '#C0392B' : colors.coralInk,
            borderWidth: 2,
            borderColor: low ? '#E7B0A6' : '#ECCDB9',
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 2,
          }}
        >
          {mm}:{ss}
        </Text>
      </View>

      {/* key by round so Round 2 always starts on a blank canvas with no stale asset */}
      <SketchCanvas key={remoteRoom?.currentRoundId ?? 'local'} ref={canvasRef} />

      {submitted ? (
        <View style={{ gap: 6, alignItems: 'center' }}>
          <Text style={{ fontSize: 18, fontWeight: '900', color: colors.ink }}>Drawing submitted!</Text>
          <Text style={{ fontSize: 14, color: colors.sub }}>Waiting for the other player...</Text>
        </View>
      ) : null}

      <Button
        label={submitted ? 'SUBMITTED' : busy ? 'SUBMITTING…' : 'SUBMIT'}
        size="lg"
        disabled={submitted || busy}
        onPress={submit}
      />
    </Screen>
  );
}
