import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
// Expo SDK 54+: '/legacy'. On SDK 53 or older, import from 'expo-file-system' instead.
import * as FileSystem from 'expo-file-system/legacy';

// Option A: scan photos are stored on this device only (no backend changes).
// Stored in documentDirectory (persistent), NOT cache -- the OS can wipe cache.
// One file per pantry item, named by its ID, so no separate lookup table is needed.
const PHOTO_DIR = `${FileSystem.documentDirectory}pantry-photos/`;
const CROP_PADDING = 0.03; // a little breathing room around the bounding box

export const pantryPhotoPath = (itemId: string) => `${PHOTO_DIR}${itemId}.jpg`;

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) =>
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject),
  );
}

/** Crops one detected item's bounding box (0-1000 scale) out of the scan photo
 *  and saves it as that pantry item's photo. */
export async function savePantryPhotoCrop(sourceUri: string, box: number[], itemId: string) {
  const { width, height } = await getImageSize(sourceUri);
  const [x1, y1, x2, y2] = box;
  const left = Math.floor(Math.max(0, x1 / 1000 - CROP_PADDING) * width);
  const top = Math.floor(Math.max(0, y1 / 1000 - CROP_PADDING) * height);
  const right = Math.floor(Math.min(1, x2 / 1000 + CROP_PADDING) * width);
  const bottom = Math.floor(Math.min(1, y2 / 1000 + CROP_PADDING) * height);
  if (right - left < 2 || bottom - top < 2) return;

  const context = ImageManipulator.manipulate(sourceUri);
  context.crop({ originX: left, originY: top, width: right - left, height: bottom - top });
  // 600px wide: sharp enough to view full-width on Food Detail, still small on disk.
  context.resize({ width: 600 });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });

  await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true }).catch(() => {});
  await FileSystem.moveAsync({ from: saved.uri, to: pantryPhotoPath(itemId) });
}

export async function getPantryPhotoUri(itemId: string): Promise<string | null> {
  const path = pantryPhotoPath(itemId);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? path : null;
}

export async function deletePantryPhoto(itemId: string) {
  await FileSystem.deleteAsync(pantryPhotoPath(itemId), { idempotent: true });
}

/** Returns the saved photo for this item, or null (caller falls back to the icon). */
export function usePantryPhoto(itemId?: string): string | null {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUri(null);
    if (!itemId) return;
    getPantryPhotoUri(itemId)
      .then((u) => {
        if (alive) setUri(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [itemId]);
  return uri;
}