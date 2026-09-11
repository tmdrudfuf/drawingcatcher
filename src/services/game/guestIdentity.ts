import AsyncStorage from '@react-native-async-storage/async-storage';

const PLAYER_ID_KEY = 'drawingcatcher.guestPlayerId';
const DISPLAY_NAME_KEY = 'drawingcatcher.guestDisplayName';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fallbackName(): string {
  return `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
}

export interface GuestIdentity {
  playerId: string;
  displayName: string;
}

export async function getGuestIdentity(displayNameInput?: string): Promise<GuestIdentity> {
  const trimmed = displayNameInput?.trim();
  let playerId = await AsyncStorage.getItem(PLAYER_ID_KEY);
  let displayName = trimmed || (await AsyncStorage.getItem(DISPLAY_NAME_KEY));

  if (!playerId) {
    playerId = randomId();
    await AsyncStorage.setItem(PLAYER_ID_KEY, playerId);
  }

  if (!displayName) {
    displayName = fallbackName();
  }

  await AsyncStorage.setItem(DISPLAY_NAME_KEY, displayName);

  return { playerId, displayName };
}
