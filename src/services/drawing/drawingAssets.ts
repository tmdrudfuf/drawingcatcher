import { decode } from 'base64-arraybuffer';

import { supabase, supabaseConfigError } from '@/providers/supabase/supabase';
import type { PlayerDrawing } from '@/types/game';

/**
 * Storage/drawing service boundary. The only place the app talks to Supabase
 * Storage. Screens and the game provider deal in deterministic paths and public
 * URLs, never in bucket calls.
 */

export const DRAWINGS_BUCKET = 'drawings';

export interface DrawingAssetRef {
  gameId: string;
  roundId: string;
  playerId: string;
}

/** Deterministic, traceable object path — one per player per round. */
export function drawingObjectPath({ gameId, roundId, playerId }: DrawingAssetRef): string {
  return `games/${gameId}/rounds/${roundId}/${playerId}.png`;
}

function requireClient() {
  if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase is not available.');
  return supabase;
}

/**
 * Upload a base64-encoded PNG (no data: prefix) to the deterministic path.
 * `upsert` is on so a retry after a failed submit overwrites the same object
 * instead of creating a duplicate asset. Returns the stored object path.
 */
export async function uploadDrawingPng(ref: DrawingAssetRef, pngBase64: string): Promise<string> {
  const client = requireClient();
  const path = drawingObjectPath(ref);
  const bytes = decode(pngBase64);
  const { error } = await client.storage.from(DRAWINGS_BUCKET).upload(path, bytes, {
    contentType: 'image/png',
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Public URL for a stored drawing path, or null when there is no path yet. */
export function publicDrawingUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!supabase) return null;
  return supabase.storage.from(DRAWINGS_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * The URI a screen should render for a player's drawing. The local device's own
 * fresh preview wins (no re-download), but always falls back to the uploaded
 * asset so a JS reload that clears the in-memory preview still shows the sketch.
 */
export function resolveDrawingUri(
  drawing: PlayerDrawing,
  isLocalPlayer: boolean,
  localDrawingUri: string | null,
): string | null {
  return (isLocalPlayer ? localDrawingUri : null) ?? publicDrawingUrl(drawing.drawingPath);
}
