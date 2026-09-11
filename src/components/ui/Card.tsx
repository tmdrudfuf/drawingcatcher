import React from 'react';
import { View, type ViewStyle } from 'react-native';

import { colors, radius, space } from '@/theme';

type Tone = 'default' | 'coral' | 'payoff';

export function Card({
  children,
  tone = 'default',
  style,
}: {
  children: React.ReactNode;
  tone?: Tone;
  style?: ViewStyle;
}) {
  const tones: Record<Tone, ViewStyle> = {
    default: { borderColor: colors.line2, backgroundColor: colors.cardTint },
    coral: { borderColor: colors.coral, backgroundColor: colors.coralTint },
    payoff: { borderColor: colors.coral, backgroundColor: colors.card },
  };
  return (
    <View
      style={[
        { borderWidth: 2, borderRadius: radius.lg, padding: space.md, gap: space.sm },
        tones[tone],
        style,
      ]}
    >
      {children}
    </View>
  );
}
