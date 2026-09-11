import React from 'react';
import { Pressable, Text, type ViewStyle } from 'react-native';

import { colors, radius } from '@/theme';

type Variant = 'primary' | 'ghost' | 'link';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'md' | 'lg';
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({ label, onPress, variant = 'primary', size = 'md', disabled = false, style }: Props) {
  const big = size === 'lg';

  const variantStyle: Record<Variant, ViewStyle> = {
    primary: { backgroundColor: colors.coral, borderBottomWidth: 4, borderBottomColor: colors.coralInk },
    ghost: { borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card },
    link: { paddingVertical: 8 },
  };
  const textColor = variant === 'primary' ? '#fff' : variant === 'link' ? colors.sub : colors.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        {
          borderRadius: radius.md,
          paddingVertical: big ? 18 : 14,
          paddingHorizontal: 18,
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 48,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        variantStyle[variant],
        style,
      ]}
    >
      <Text
        style={{
          color: textColor,
          fontWeight: '800',
          fontSize: big ? 19 : 15,
          letterSpacing: 0.4,
          textAlign: 'center',
          textDecorationLine: variant === 'link' ? 'underline' : 'none',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
