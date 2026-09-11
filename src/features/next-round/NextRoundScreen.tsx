import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { CatDoodle } from '@/components/game/CatDoodle';
import { MotionCat } from '@/components/game/MotionCat';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { Screen } from '@/components/ui/Screen';
import { useGame } from '@/providers/game/GameProvider';
import { colors } from '@/theme';

export function NextRoundScreen() {
  const { state, remoteRoom, remotePlayers, localPlayer, winner, nextRound, endGame } = useGame();
  const waitingForNext = Boolean(localPlayer?.wantsNextRound);

  useEffect(() => {
    // In a remote game the round advancing wipes judgeResult before the /prompt
    // redirect below fires — don't bounce home in that window.
    if (!remoteRoom && !state.judgeResult) router.replace('/');
  }, [remoteRoom, state.judgeResult]);

  useEffect(() => {
    if (remoteRoom?.phase === 'prompt' && remoteRoom.currentRoundNumber > 1) router.replace('/prompt');
    if (remoteRoom?.status === 'ended') router.replace('/');
  }, [remoteRoom?.currentRoundNumber, remoteRoom?.phase, remoteRoom?.status]);

  const goNext = async () => {
    await nextRound();
    if (!remoteRoom) router.replace('/prompt');
  };

  const quit = async () => {
    await endGame();
    router.replace('/');
  };

  return (
    <Screen center style={{ alignItems: 'center', gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 12 }}>
        {state.players.map((p) => (
          <View key={p.id} style={{ alignItems: 'center' }}>
            {winner && p.id === winner.id ? (
              <MotionCat variant={p.drawing.sketchVariant} size={124} motions={['bounce', 'blink']} />
            ) : (
              <CatDoodle variant={p.drawing.sketchVariant} characterized size={116} />
            )}
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.faint }}>
              {p.name}
            </Text>
          </View>
        ))}
      </View>

      <Text style={{ fontSize: 24, fontWeight: '900', color: colors.ink }}>ROUND COMPLETE!</Text>
      <Text style={{ fontSize: 18, color: colors.coralInk, fontWeight: '700' }}>One more?</Text>

      {remoteRoom ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {remotePlayers.map((player) => (
            <Pill
              key={player.id}
              label={`${player.name}: ${player.wantsNextRound ? 'NEXT' : 'WAITING'}`}
              tone={player.wantsNextRound ? 'green' : 'yellow'}
            />
          ))}
        </View>
      ) : null}

      <View style={{ flex: 1 }} />
      <View style={{ alignSelf: 'stretch', gap: 8 }}>
        <Button label={waitingForNext ? 'WAITING FOR FRIEND' : 'NEXT ROUND'} size="lg" disabled={waitingForNext} onPress={goNext} />
        <Button label="END GAME" variant="link" onPress={quit} />
      </View>
    </Screen>
  );
}
