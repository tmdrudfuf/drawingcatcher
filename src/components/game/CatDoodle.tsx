import React from 'react';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import type { SketchVariant } from '@/types/game';

const INK = '#2F2B26';

interface Props {
  variant: SketchVariant;
  /** Characterized = grey fill + motion smears, but the SAME silhouette. */
  characterized?: boolean;
  /** Closes the eyes — used by MotionCat for the blink loop. */
  blink?: boolean;
  /** Width in px; height is 0.8 * size. */
  size?: number;
}

/**
 * The two deliberately bad cats, ported from design/Main.dc.html.
 * Preserve first: characterized keeps every quirk (tiny legs, oversized head,
 * uneven eyes, crooked tail) and only adds fill + motion smears.
 */
export function CatDoodle({ variant, characterized = false, blink = false, size = 150 }: Props) {
  return (
    <Svg width={size} height={size * 0.8} viewBox="0 0 150 120">
      {variant === 'p1' ? (
        characterized ? <P1Char blink={blink} /> : <P1Sketch />
      ) : characterized ? (
        <P2Char blink={blink} />
      ) : (
        <P2Sketch />
      )}
    </Svg>
  );
}

/* ---- Player 1: huge oval body, tiny legs, uneven eyes, raised curved tail ---- */

function P1Sketch() {
  return (
    <>
      <G fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <Ellipse cx={80} cy={76} rx={48} ry={31} />
        <Circle cx={42} cy={44} r={18} />
        <Path d="M26 34 L33 12 L45 32 Z" />
        <Path d="M45 31 L56 13 L65 33 Z" />
        <Path d="M29 49 L9 45 M29 52 L8 54 M30 55 L10 61" />
        <Path d="M56 48 L71 44 M56 51 L72 53" />
        <Path d="M54 104 L53 116 M76 106 L76 117 M100 105 L102 116 M120 101 L122 113" />
        <Path d="M126 80 C150 72 148 30 133 20" />
        <Path d="M44 92 q34 12 72 0" opacity={0.4} />
        <Path d="M45 53 q4 4 9 2" />
      </G>
      <Circle cx={37} cy={44} r={2.8} fill={INK} />
      <Circle cx={49} cy={41} r={1.8} fill={INK} />
      <Path d="M41 50 l4 0 l-2 3 Z" fill={INK} />
    </>
  );
}

function P1Char({ blink }: { blink: boolean }) {
  return (
    <>
      <Ellipse cx={80} cy={116} rx={46} ry={5} fill="rgba(0,0,0,0.06)" />
      <Ellipse cx={80} cy={76} rx={48} ry={31} fill="#D3CEC1" stroke={INK} strokeWidth={3} />
      <Circle cx={42} cy={44} r={18} fill="#DDD8CB" stroke={INK} strokeWidth={3} />
      <G fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M26 34 L33 12 L45 32 Z" />
        <Path d="M45 31 L56 13 L65 33 Z" />
        <Path d="M29 49 L11 45 M29 52 L10 54" />
        <Path d="M56 48 L71 44 M56 51 L72 53" />
        <Path d="M54 104 L53 114 M76 106 L76 115 M100 105 L102 114 M120 101 L122 111" />
        <Path d="M126 80 C150 72 148 30 133 20" />
      </G>
      <Path d="M40 110 q7 5 14 0 M66 112 q7 5 14 0 M96 110 q7 5 14 0" fill="none" stroke={INK} strokeWidth={2} opacity={0.4} />
      <Path d="M138 18 q7 -4 11 -12 M139 28 q9 -3 15 -9" fill="none" stroke={INK} strokeWidth={2} opacity={0.4} />
      <Path d="M16 14 l0 9 M11 18 l9 0" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
      {blink ? (
        <Path d="M33 44 l8 0 M45 41 l6 0" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
      ) : (
        <>
          <Circle cx={37} cy={44} r={2.8} fill={INK} />
          <Path d="M46 41 l5 0" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
        </>
      )}
      <Path d="M41 50 l4 0 l-2 3 Z" fill={INK} />
    </>
  );
}

/* ---- Player 2: oversized head, small body, long thin legs, crooked tail, surprised face ---- */

function P2Sketch() {
  return (
    <>
      <G fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <Ellipse cx={84} cy={84} rx={24} ry={15} />
        <Circle cx={60} cy={44} r={30} />
        <Path d="M40 24 L44 3 L58 22 Z" />
        <Path d="M66 21 L82 3 L88 25 Z" />
        <Path d="M40 52 L24 49 M40 55 L25 59" />
        <Path d="M80 50 L96 47 M80 53 L95 57" />
      </G>
      <G fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round">
        <Path d="M70 96 L60 119" />
        <Path d="M80 98 L78 119" />
        <Path d="M90 97 L98 118" />
        <Path d="M98 94 L110 116" />
      </G>
      <Path
        d="M104 82 L118 76 L112 64 L124 58 L118 47"
        fill="none"
        stroke={INK}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={50} cy={45} r={4.6} fill="none" stroke={INK} strokeWidth={2.4} />
      <Circle cx={70} cy={42} r={5.4} fill="none" stroke={INK} strokeWidth={2.4} />
      <Circle cx={50} cy={45} r={1.6} fill={INK} />
      <Circle cx={70} cy={42} r={1.8} fill={INK} />
      <Ellipse cx={60} cy={60} rx={3.4} ry={4.4} fill="none" stroke={INK} strokeWidth={2.4} />
    </>
  );
}

function P2Char({ blink }: { blink: boolean }) {
  return (
    <>
      <Ellipse cx={82} cy={116} rx={34} ry={4.5} fill="rgba(0,0,0,0.06)" />
      <Ellipse cx={84} cy={84} rx={24} ry={15} fill="#D3CEC1" stroke={INK} strokeWidth={3} />
      <Circle cx={60} cy={44} r={30} fill="#DDD8CB" stroke={INK} strokeWidth={3} />
      <G fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M40 24 L44 3 L58 22 Z" />
        <Path d="M66 21 L82 3 L88 25 Z" />
      </G>
      <G fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round">
        <Path d="M70 96 L62 118" />
        <Path d="M80 98 L79 119" />
        <Path d="M90 97 L97 118" />
        <Path d="M98 94 L108 116" />
      </G>
      <Path
        d="M104 82 L118 76 L112 64 L124 58 L118 47"
        fill="none"
        stroke={INK}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M56 119 q6 4 12 0 M86 120 q6 4 12 0" fill="none" stroke={INK} strokeWidth={2} opacity={0.4} />
      <Path d="M120 44 q7 -3 10 -10 M122 54 q9 -2 14 -8" fill="none" stroke={INK} strokeWidth={2} opacity={0.4} />
      <Path d="M20 16 l0 9 M15 20 l9 0" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
      {blink ? (
        <Path d="M45 45 l10 0 M64 42 l10 0" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      ) : (
        <>
          <Circle cx={50} cy={45} r={4.6} fill="none" stroke={INK} strokeWidth={2.4} />
          <Path d="M64 40 l10 0" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
          <Circle cx={50} cy={45} r={1.6} fill={INK} />
        </>
      )}
      <Ellipse cx={60} cy={60} rx={3.4} ry={4.4} fill="none" stroke={INK} strokeWidth={2.4} />
    </>
  );
}
