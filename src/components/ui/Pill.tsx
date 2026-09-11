import React from 'react';
import { Text, View } from 'react-native';

import { colors, radius } from '@/theme';

type Tone = 'default' | 'green' | 'coral' | 'yellow';

export function Pill({ label, tone = 'default' }: { label: string; tone?: Tone }) {
  const tones: Record<Tone, { bg: string; border: string; fg: string }> = {
    default: { bg: colors.card, border: colors.line, fg: colors.sub },
    green: { bg: colors.greenTint, border: colors.green, fg: colors.green },
    coral: { bg: colors.coralTint, border: colors.coral, fg: colors.coralInk },
    yellow: { bg: colors.yellowTint, border: '#E6C27A', fg: colors.yellowInk },
  };
  const t = tones[tone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderWidth: 2,
        borderColor: t.border,
        backgroundColor: t.bg,
        borderRadius: radius.pill,
        paddingVertical: 4,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ color: t.fg, fontWeight: '800', fontSize: 12, letterSpacing: 0.4 }}>{label}</Text>
    </View>
  );
}
