import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { CatDoodle } from '@/components/game/CatDoodle';
import { RemoteDrawing } from '@/components/game/RemoteDrawing';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { useGame } from '@/providers/game/GameProvider';
import { judgeService, type JudgeRoundResult } from '@/services/ai/judge';
import { track } from '@/services/analytics/analytics';
import { resolveDrawingUri } from '@/services/drawing/drawingAssets';
import { colors } from '@/theme';

export function JudgeScreen() {
  const { state, isRemoteGame, localPlayerId, localDrawingUri, completeRemoteJudging, reportJudgeResult } = useGame();
  const [cues, setCues] = useState<string[]>([]);
  const [shown, setShown] = useState(0);
  const resultRef = useRef<JudgeRoundResult | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (state.roundNumber === 0) {
      router.replace('/');
      return;
    }

    if (isRemoteGame) {
      const result: JudgeRoundResult = {
        players: [
          {
            playerId: state.players[0].id,
            score: 87,
            recognized: true,
            observations: ['cat detected', 'tiny legs', 'raised curved tail'],
          },
          {
            playerId: state.players[1].id,
            score: 74,
            recognized: true,
            observations: ['cat detected', 'unusually long legs', 'surprised face'],
          },
        ],
        winnerPlayerId: state.players[0].id,
        comment: 'Those tiny legs somehow made the cat more powerful.',
        suspenseCues: [
          'CAT DETECTED',
          'TINY LEGS DETECTED...',
          'ANATOMY: QUESTIONABLE',
          'ARTISTIC CONFIDENCE: SOMEHOW HIGH',
        ],
      };
      resultRef.current = result;
      const t = setTimeout(() => setCues(result.suspenseCues), 0);
      return () => clearTimeout(t);
    }

    let cancelled = false;
    track('judge_started');
    judgeService
      .judgeRound({ prompt: state.prompt, drawings: state.players.map((p) => p.drawing) })
      .then((res) => {
        if (!cancelled) {
          resultRef.current = res;
          setCues(res.suspenseCues);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isRemoteGame, state.roundNumber, state.prompt, state.players]);

  useEffect(() => {
    if (isRemoteGame && state.phase === 'results') router.replace('/results');
  }, [isRemoteGame, state.phase]);

  useEffect(() => {
    if (cues.length === 0) return;
    if (shown < cues.length) {
      const t = setTimeout(() => setShown((n) => n + 1), 620);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      if (doneRef.current || !resultRef.current) return;
      doneRef.current = true;
      if (isRemoteGame) {
        completeRemoteJudging();
      } else {
        reportJudgeResult(resultRef.current);
        router.replace('/results');
      }
    }, 900);
    return () => clearTimeout(t);
  }, [completeRemoteJudging, cues, isRemoteGame, reportJudgeResult, shown]);

  const calculating = cues.length > 0 && shown >= cues.length;

  return (
    <Screen>
      <Text style={{ fontSize: 17, fontWeight: '800', textTransform: 'uppercase', color: colors.ink }}>
        AI Judge
      </Text>
      <Text style={{ fontSize: 22, fontWeight: '800', textAlign: 'center', color: colors.ink }}>
        AI is judging…
      </Text>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18 }}>
        {state.players.map((p, i) => (
          <View key={p.id} style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.faint }}>
              P{i + 1}
            </Text>
            {isRemoteGame ? (
              <RemoteDrawing
                uri={resolveDrawingUri(p.drawing, p.id === localPlayerId, localDrawingUri)}
                size={104}
                label={p.id}
              />
            ) : (
              <CatDoodle variant={p.drawing.sketchVariant} size={104} />
            )}
          </View>
        ))}
      </View>

      <Card style={{ borderStyle: 'dashed', borderColor: '#E0B596', backgroundColor: '#FFF8F2', gap: 10 }}>
        {cues.length === 0 ? (
          <Text style={{ color: colors.sub, fontSize: 13 }}>inspecting the drawings…</Text>
        ) : (
          cues.slice(0, shown).map((c) => (
            <Text key={c} style={{ fontWeight: '800', fontSize: 13, letterSpacing: 0.5, color: colors.ink }}>
              {c}
            </Text>
          ))
        )}
      </Card>

      <View style={{ flex: 1 }} />
      <Text
        style={{
          textAlign: 'center',
          fontSize: 15,
          fontWeight: '700',
          color: colors.sub,
          opacity: calculating ? 1 : 0,
        }}
      >
        CALCULATING SCORES…
      </Text>
    </Screen>
  );
}
