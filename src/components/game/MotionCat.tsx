import React, { useEffect, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';

import type { MotionName } from '@/services/ai/animation';
import type { SketchVariant } from '@/types/game';
import { CatDoodle } from './CatDoodle';

interface Props {
  variant: SketchVariant;
  size?: number;
  motions?: MotionName[];
  /** When false, the cat holds still (used for the non-winner on Next Round). */
  active?: boolean;
}

const useNativeDriver = Platform.OS !== 'web';

/**
 * Milestone 1 "animation": lightweight client-side motion on the characterized
 * doodle. No video. Bounce + waddle rotate + a periodic blink.
 */
export function MotionCat({ variant, size = 200, motions = [], active = true }: Props) {
  const [bounce] = useState(() => new Animated.Value(0));
  const [waddle] = useState(() => new Animated.Value(0));
  const [blink, setBlink] = useState(false);

  const anyMotion = motions.length === 0;
  const wantBounce = active && (anyMotion || motions.includes('bounce') || motions.includes('stumble'));
  const wantWaddle = active && (anyMotion || motions.includes('waddle') || motions.includes('tailWag'));
  const wantBlink = active && (anyMotion || motions.includes('blink'));

  useEffect(() => {
    if (!wantBounce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver }),
        Animated.timing(bounce, { toValue: 0, duration: 520, easing: Easing.in(Easing.quad), useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bounce, wantBounce]);

  useEffect(() => {
    if (!wantWaddle) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(waddle, { toValue: 1, duration: 300, easing: Easing.inOut(Easing.quad), useNativeDriver }),
        Animated.timing(waddle, { toValue: -1, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver }),
        Animated.timing(waddle, { toValue: 0, duration: 300, easing: Easing.inOut(Easing.quad), useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [waddle, wantWaddle]);

  useEffect(() => {
    if (!wantBlink) return;
    const id = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 140);
    }, 2600);
    return () => clearInterval(id);
  }, [wantBlink]);

  const translateY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });
  const rotate = waddle.interpolate({ inputRange: [-1, 1], outputRange: ['-5deg', '5deg'] });

  return (
    <Animated.View style={{ transform: [{ translateY }, { rotate }] }}>
      <CatDoodle variant={variant} characterized blink={blink} size={size} />
    </Animated.View>
  );
}
