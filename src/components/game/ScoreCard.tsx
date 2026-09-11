import React from 'react';
import { Text } from 'react-native';

import { Card } from '@/components/ui/Card';
import { colors } from '@/theme';
import type { SketchVariant } from '@/types/game';
import { CatDoodle } from './CatDoodle';
import { RemoteDrawing } from './RemoteDrawing';

interface Props {
  name: string;
  score: number;
  variant: SketchVariant;
  winner?: boolean;
  /** Real submitted drawing. When provided (remote games) it replaces the doodle. */
  drawingUri?: string | null;
  hasRealDrawing?: boolean;
}

export function ScoreCard({ name, score, variant, winner = false, drawingUri, hasRealDrawing = false }: Props) {
  return (
    <Card tone={winner ? 'coral' : 'default'} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <Text style={{ fontWeight: '800', fontSize: 11, letterSpacing: 1, color: colors.faint }}>
        {name.toUpperCase()}
      </Text>
      {hasRealDrawing ? (
        <RemoteDrawing uri={drawingUri ?? null} size={130} label={name} />
      ) : (
        <CatDoodle variant={variant} size={130} />
      )}
      <Text style={{ fontWeight: '800', fontSize: 32, color: winner ? colors.ink : colors.faint }}>
        {score}
        {winner ? ' 🏆' : ''}
      </Text>
    </Card>
  );
}
