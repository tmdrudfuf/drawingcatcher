import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { ScoreCard } from '@/components/game/ScoreCard';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useGame } from '@/providers/game/GameProvider';
import { track } from '@/services/analytics/analytics';
import { resolveDrawingUri } from '@/services/drawing/drawingAssets';
import { colors, radius } from '@/theme';

export function ResultsScreen() {
  const { state, remoteRoom, isRemoteGame, localPlayerId, localDrawingUri, winner, markRemoteReveal } = useGame();
  const result = state.judgeResult;

  useEffect(() => {
    if (!result) {
      router.replace('/');
      return;
    }
    track('results_viewed');
  }, [result]);

  useEffect(() => {
    if (remoteRoom?.phase === 'reveal') router.replace('/reveal');
    if (remoteRoom?.status === 'ended') router.replace('/');
  }, [remoteRoom?.phase, remoteRoom?.status]);

  if (!result || !winner) return <Screen />;

  const scoreFor = (id: string) => result.players.find((p) => p.playerId === id)?.score ?? 0;

  return (
    <Screen>
      <Text style={{ fontSize: 17, fontWeight: '800', textTransform: 'uppercase', color: colors.ink }}>
        Results
      </Text>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {state.players.map((p) => (
          <ScoreCard
            key={p.id}
            name={p.name}
            score={scoreFor(p.id)}
            variant={p.drawing.sketchVariant}
            winner={p.id === winner.id}
            hasRealDrawing={isRemoteGame}
            drawingUri={resolveDrawingUri(p.drawing, p.id === localPlayerId, localDrawingUri)}
          />
        ))}
      </View>

      <Text style={{ textAlign: 'center', fontSize: 26, fontWeight: '900', color: colors.coralInk }}>
        {winner.name} WINS!
      </Text>

      <View
        style={{
          borderWidth: 2,
          borderColor: colors.line,
          borderRadius: radius.md,
          backgroundColor: colors.card,
          padding: 12,
        }}
      >
        <Text style={{ fontSize: 15, color: colors.ink, fontStyle: 'italic' }}>{`"${result.comment}"`}</Text>
      </View>

      <View style={{ flex: 1 }} />
      <Button
        label="BRING THEM TO LIFE"
        size="lg"
        onPress={async () => {
          await markRemoteReveal();
          router.replace('/reveal');
        }}
      />
      <Text style={{ textAlign: 'center', fontSize: 13, color: colors.faint }}>the round is not over yet</Text>
    </Screen>
  );
}
