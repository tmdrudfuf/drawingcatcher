import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const PLAYER_ID_KEY = 'drawingcatcher.guestPlayerId';
const DISPLAY_NAME_KEY = 'drawingcatcher.guestDisplayName';
const PLAYER_SECRET_KEY = 'drawingcatcher.guestPlayerSecret';
// 256 bits -- the M4C player_credentials bearer secret is a high-entropy
// random token, never a human password, so this is the whole security
// margin. See supabase/migrations/202609100008_milestone4c_player_credentials.sql.
const SECRET_BYTE_LENGTH = 32;

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fallbackName(): string {
  return `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * playerSecret generation MUST use cryptographically secure randomness only
 * -- it is a bearer credential, not a display id, so randomId()'s
 * Date.now()/Math.random() fallback is never acceptable here.
 * expo-crypto's getRandomBytesAsync is backed by the platform's real CSPRNG
 * (SecRandomCopyBytes on iOS, SecureRandom on Android). If it throws (e.g.
 * the native module is unavailable), that throw is left to propagate --
 * this function must fail rather than fall back to a weak secret.
 */
async function generateSecureSecret(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(SECRET_BYTE_LENGTH);
  return bytesToHex(bytes);
}

export interface GuestIdentity {
  playerId: string;
  displayName: string;
  /**
   * null means this is a legacy local identity: playerId was created before
   * playerSecret existed. Callers (GameProvider.ensureIdentity) must
   * rotateGuestIdentity() before ever registering it -- never attach a new
   * secret to a playerId that may already be visible to another device.
   */
  playerSecret: string | null;
}

export async function getGuestIdentity(displayNameInput?: string): Promise<GuestIdentity> {
  const trimmed = displayNameInput?.trim();
  const playerId = await AsyncStorage.getItem(PLAYER_ID_KEY);
  let displayName = trimmed || (await AsyncStorage.getItem(DISPLAY_NAME_KEY));
  if (!displayName) {
    displayName = fallbackName();
  }

  if (!playerId) {
    // Brand-new identity: id and secret are created together, atomically
    // persisted, so a fresh playerId is never left without its secret.
    const newPlayerId = randomId();
    const playerSecret = await generateSecureSecret();
    await AsyncStorage.multiSet([
      [PLAYER_ID_KEY, newPlayerId],
      [PLAYER_SECRET_KEY, playerSecret],
      [DISPLAY_NAME_KEY, displayName],
    ]);
    return { playerId: newPlayerId, displayName, playerSecret };
  }

  // Existing playerId: load its secret, if any. A missing secret means this
  // is a legacy identity -- it is surfaced as null, never silently generated
  // here (see rotateGuestIdentity for the only path that mints a new pair).
  const playerSecret = await AsyncStorage.getItem(PLAYER_SECRET_KEY);
  await AsyncStorage.setItem(DISPLAY_NAME_KEY, displayName);

  return { playerId, displayName, playerSecret };
}

/**
 * Rotates to a brand-new playerId + playerSecret pair, preserving
 * displayName. Used for legacy identities -- detected locally (no stored
 * secret) or reported by the server (register_or_touch_player's
 * legacy_identity_requires_rotation) -- because an existing playerId may
 * already be visible to another device and must never be retrofitted with a
 * secret via "first caller wins".
 */
export async function rotateGuestIdentity(): Promise<GuestIdentity> {
  const displayName = (await AsyncStorage.getItem(DISPLAY_NAME_KEY)) || fallbackName();
  const playerId = randomId();
  const playerSecret = await generateSecureSecret();
  await AsyncStorage.multiSet([
    [PLAYER_ID_KEY, playerId],
    [PLAYER_SECRET_KEY, playerSecret],
    [DISPLAY_NAME_KEY, displayName],
  ]);
  return { playerId, displayName, playerSecret };
}
