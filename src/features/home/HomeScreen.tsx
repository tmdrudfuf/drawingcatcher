import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Text, View } from 'react-native';

import { CatDoodle } from '@/components/game/CatDoodle';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { track } from '@/services/analytics/analytics';
import { colors } from '@/theme';

export function HomeScreen() {
  useEffect(() => {
    track('app_opened');
  }, []);

  return (
    <Screen center style={{ alignItems: 'center', gap: 12 }}>
      <Text
        style={{
          fontSize: 40,
          fontWeight: '900',
          color: colors.ink,
          textAlign: 'center',
          lineHeight: 44,
        }}
      >
        Drawing{'\n'}Catcher
      </Text>
      <Text style={{ fontSize: 15, color: colors.sub }}>draw · let AI judge · bring it to life</Text>

      <View style={{ marginVertical: 8 }}>
        <CatDoodle variant="p1" size={170} />
      </View>

      <View style={{ alignSelf: 'stretch', gap: 8 }}>
        <Button label="PLAY" size="lg" onPress={() => router.push('/setup')} />
        <Button
          label="How to Play"
          variant="link"
          onPress={() =>
            Alert.alert(
              'How to Play',
              'Two players get the same prompt, draw it fast, and AI picks a winner. ' +
                'Then your actual sketches come alive as characters. One more round?',
            )
          }
        />
      </View>

      <Text style={{ fontSize: 13, color: colors.faint }}>no login — just play</Text>
    </Screen>
  );
}
