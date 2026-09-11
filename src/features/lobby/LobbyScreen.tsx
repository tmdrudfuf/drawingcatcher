import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { Screen } from '@/components/ui/Screen';
import { useGame } from '@/providers/game/GameProvider';
import { colors, radius } from '@/theme';

export function LobbyScreen() {
  const { remoteRoom, remotePlayers, localPlayer, isHost, loading, error, startGame, toggleReady } = useGame();
  const bothReady = remotePlayers.length === 2 && remotePlayers.every((player) => player.ready);

  useEffect(() => {
    if (remoteRoom?.status === 'ended') router.replace('/');
    if (remoteRoom?.currentRoundId && remoteRoom.phase === 'prompt') router.replace('/prompt');
  }, [remoteRoom?.currentRoundId, remoteRoom?.phase, remoteRoom?.status]);

  const start = async () => {
    await startGame();
  };

  return (
    <Screen>
      <Text style={{ fontSize: 19, fontWeight: '800', textTransform: 'uppercase', color: colors.ink }}>
        Duo Lobby
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ fontSize: 14, color: colors.sub }}>room</Text>
        <Text style={{ fontSize: 20, fontWeight: '800', letterSpacing: 4, color: colors.coralInk }}>
          {remoteRoom?.roomCode ?? '----'}
        </Text>
      </View>

      <View style={{ flex: 1 }} />

      {[1, 2].map((slot) => {
        const player = remotePlayers.find((p) => p.slot === slot);
        return (
          <View
            key={slot}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderWidth: 2,
              borderColor: colors.line2,
              borderRadius: radius.md,
              padding: 12,
            }}
          >
            <View>
              <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.faint }}>
                PLAYER {slot}
              </Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.ink }}>
                {player?.name ?? 'Waiting...'}
              </Text>
            </View>
            <Pill label={player?.ready ? 'READY' : player ? 'NOT READY' : 'EMPTY'} tone={player?.ready ? 'green' : 'yellow'} />
          </View>
        );
      })}

      <Text style={{ textAlign: 'center', fontSize: 15, color: colors.ink, fontWeight: '700' }}>
        {bothReady ? 'Both players ready!' : remotePlayers.length < 2 ? 'Waiting for Player 2' : 'Ready when you are'}
      </Text>
      {error ? (
        <Text style={{ textAlign: 'center', fontSize: 13, color: '#C0392B', fontWeight: '700' }}>{error}</Text>
      ) : null}

      <View style={{ flex: 1 }} />
      <Button
        label={localPlayer?.ready ? 'UNREADY' : 'READY'}
        variant={localPlayer?.ready ? 'ghost' : 'primary'}
        disabled={!localPlayer || loading}
        onPress={toggleReady}
      />
      <Button
        label={loading ? 'STARTING...' : isHost ? 'START ROUND' : 'WAITING FOR HOST'}
        size="lg"
        disabled={!isHost || !bothReady || loading}
        onPress={start}
      />
    </Screen>
  );
}
