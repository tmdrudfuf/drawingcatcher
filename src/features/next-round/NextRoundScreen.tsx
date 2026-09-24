import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { CatDoodle } from '@/components/game/CatDoodle';
import { MotionCat } from '@/components/game/MotionCat';
import { RemoteDrawing } from '@/components/game/RemoteDrawing';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { Screen } from '@/components/ui/Screen';
import { useGame } from '@/providers/game/GameProvider';
import { publicCharacterizedUrl, resolveDrawingUri } from '@/services/drawing/drawingAssets';
import { colors } from '@/theme';
import type { Player } from '@/types/game';

export function NextRoundScreen() {
  const {
    state,
    remoteRoom,
    remotePlayers,
    localPlayer,
    localPlayerId,
    localDrawingUri,
    isRemoteGame,
    winner,
    nextRound,
    endGame,
  } = useGame();
  const waitingForNext = Boolean(localPlayer?.wantsNextRound);

  // M6B/M6C: continuity with Reveal -- never substitute the generic built-in
  // mascot for a real Duo game's actual drawing. Priority for the winner:
  // 1) the real characterized image, 2) the real original submitted
  // drawing, 3) never the mascot. The loser prefers their real submitted
  // drawing when available. Local/demo mode (unreachable from real Duo
  // play) keeps its existing doodle art, since no real asset is ever
  // produced there.
  //
  // M6C fix: the characterized image is read from `remotePlayers`
  // (round_submissions rows already scoped to the CURRENT round by
  // fetchRoomSnapshot), never from the local `state.characterizations` map
  // -- that map is keyed only by playerId and is NOT round-scoped, so if
  // the same player wins two rounds in a row and characterization is
  // skipped on the second, it could silently hold Round N's image while
  // Round N+1 is displayed. remotePlayers can never have that problem: a
  // fresh round always starts with a fresh round_submissions row, so a
  // not-yet-characterized current round correctly reads as null here and
  // falls through to the real original drawing instead.
  const renderPlayerArt = (p: Player) => {
    const isWinner = Boolean(winner && p.id === winner.id);
    if (isRemoteGame) {
      const remoteSubmission = remotePlayers.find((rp) => rp.id === p.id);
      const characterizedUri = isWinner ? publicCharacterizedUrl(remoteSubmission?.characterizedPath) : null;
      const realUri = characterizedUri ?? resolveDrawingUri(p.drawing, p.id === localPlayerId, localDrawingUri);
      return <RemoteDrawing uri={realUri} size={isWinner ? 124 : 116} label={`${p.id}-next-round`} />;
    }
    return isWinner ? (
      <MotionCat variant={p.drawing.sketchVariant} size={124} motions={['bounce', 'blink']} />
    ) : (
      <CatDoodle variant={p.drawing.sketchVariant} characterized size={116} />
    );
  };

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
            {renderPlayerArt(p)}
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
