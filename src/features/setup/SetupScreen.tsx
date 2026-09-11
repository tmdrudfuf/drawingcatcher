import { router } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { useGame } from '@/providers/game/GameProvider';
import { colors, radius } from '@/theme';

export function SetupScreen() {
  const { createRoom, joinRoom, loading, error, clearError } = useGame();
  const [displayName, setDisplayName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const create = async () => {
    const ok = await createRoom(displayName);
    if (ok) router.push('/lobby');
  };

  const join = async () => {
    const ok = await joinRoom(joinCode, displayName);
    if (ok) router.push('/lobby');
  };

  return (
    <Screen scroll>
      <Text style={{ fontSize: 19, fontWeight: '800', textTransform: 'uppercase', color: colors.ink }}>
        Start a game
      </Text>
      <Text style={{ fontSize: 14, color: colors.sub }}>host one, or hop into a friend&apos;s</Text>

      <View style={{ flex: 1 }} />

      <Card style={{ gap: 10 }}>
        <TextInput
          value={displayName}
          onChangeText={(t) => {
            clearError();
            setDisplayName(t.slice(0, 18));
          }}
          placeholder="display name"
          placeholderTextColor={colors.faint}
          style={{
            borderWidth: 2,
            borderColor: colors.line,
            borderRadius: radius.sm,
            paddingVertical: 12,
            paddingHorizontal: 14,
            fontSize: 16,
            fontWeight: '800',
            textAlign: 'center',
            color: colors.ink,
            backgroundColor: colors.card,
          }}
        />
      </Card>

      <Card tone="coral" style={{ gap: 10 }}>
        <Button label={loading ? 'CREATING...' : 'CREATE GAME'} disabled={loading} onPress={create} />
        <Text style={{ textAlign: 'center', fontSize: 14, color: colors.sub }}>
          a room code appears in the lobby
        </Text>
      </Card>

      <Text style={{ textAlign: 'center', color: colors.sub }}>- or -</Text>

      <Card style={{ gap: 10 }}>
        <TextInput
          value={joinCode}
          onChangeText={(t) => {
            clearError();
            setJoinCode(t.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4));
          }}
          placeholder="enter room code"
          placeholderTextColor={colors.faint}
          autoCapitalize="characters"
          style={{
            borderWidth: 2,
            borderColor: colors.line,
            borderRadius: radius.sm,
            paddingVertical: 12,
            paddingHorizontal: 14,
            fontSize: 18,
            fontWeight: '800',
            letterSpacing: 6,
            textAlign: 'center',
            color: colors.ink,
            backgroundColor: colors.card,
          }}
        />
        <Button label={loading ? 'JOINING...' : 'JOIN GAME'} variant="ghost" disabled={loading} onPress={join} />
      </Card>

      {error ? (
        <Text style={{ fontSize: 13, color: '#C0392B', textAlign: 'center', fontWeight: '700' }}>{error}</Text>
      ) : null}

      <View style={{ flex: 1 }} />
      <Text style={{ fontSize: 14, color: colors.faint, textAlign: 'center' }}>
        no accounts - uses your local guest identity
      </Text>
    </Screen>
  );
}
