import React from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, space } from '@/theme';

interface Props {
  children?: React.ReactNode;
  scroll?: boolean;
  center?: boolean;
  style?: ViewStyle;
}

/** Warm off-white page frame shared by every screen. */
export function Screen({ children, scroll = false, center = false, style }: Props) {
  const inner = (
    <View
      style={[
        { flex: 1, padding: space.xl, gap: space.lg },
        center && { justifyContent: 'center' },
        style,
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}
