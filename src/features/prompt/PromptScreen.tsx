import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { CatDoodle } from '@/components/game/CatDoodle';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useGame } from '@/providers/game/GameProvider';
import { colors, radius, timing } from '@/theme';

export function PromptScreen() {
  const { state, remoteRoom, beginDrawing } = useGame();

  useEffect(() => {
    if (state.roundNumber === 0) router.replace('/');
    if (remoteRoom?.phase === 'drawing') router.replace('/draw');
    if (remoteRoom?.status === 'ended') router.replace('/');
  }, [remoteRoom?.phase, remoteRoom?.status, state.roundNumber]);

  const start = async () => {
    await beginDrawing();
    router.replace('/draw');
  };

  return (
    <Screen center style={{ alignItems: 'center', gap: 16 }}>
      <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.faint }}>
        ROUND {state.roundNumber || 1}
      </Text>

      <View
        style={{
          borderWidth: 2,
          borderColor: '#E0B596',
          borderStyle: 'dashed',
          borderRadius: radius.lg,
          backgroundColor: '#FFF8F2',
          paddingVertical: 22,
          paddingHorizontal: 18,
          alignItems: 'center',
          gap: 12,
          alignSelf: 'stretch',
        }}
      >
        <CatDoodle variant="p1" size={48} />
        <Text
          style={{
            fontSize: 30,
            fontWeight: '900',
            color: colors.ink,
            textTransform: 'uppercase',
            textAlign: 'center',
            alignSelf: 'stretch',
          }}
        >
          {state.prompt || 'Draw a cat'}
        </Text>
        <Text style={{ fontSize: 13, fontWeight: '800', color: colors.sub, letterSpacing: 1 }}>
          {timing.roundSeconds} SECONDS
        </Text>
      </View>

      <Text style={{ fontSize: 15, color: colors.sub, textAlign: 'center' }}>
        Make it recognizable.{'\n'}Or don&apos;t. The AI will decide.
      </Text>

      <View style={{ alignSelf: 'stretch' }}>
        <Button label="START DRAWING" size="lg" onPress={start} />
      </View>
    </Screen>
  );
}
