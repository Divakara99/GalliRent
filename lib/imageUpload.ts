import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { LISTING_PHOTOS_BUCKET } from './media';
import { supabase } from './supabase';

export interface UploadProgress {
  completed: number;
  total: number;
}

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.72;

export async function compressListingImage(uri: string): Promise<string> {
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: MAX_WIDTH } }],
    { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
  );
  return result.uri;
}

/**
 * Compress each photo, then upload to `<uid>/<draftId>/<index>.jpg`.
 * The Storage policy and `create_listing` RPC both validate this exact path.
 */
export async function uploadListingPhotos(
  userId: string,
  draftId: string,
  uris: string[],
  onProgress?: (progress: UploadProgress) => void,
): Promise<string[]> {
  if (uris.length < 1 || uris.length > 10) {
    throw new Error('Choose between 1 and 10 photos.');
  }

  const uploaded: string[] = [];
  try {
    for (let index = 0; index < uris.length; index += 1) {
      const compressedUri = await compressListingImage(uris[index]);
      const buffer = await new File(compressedUri).arrayBuffer();
      const path = `${userId}/${draftId}/${index}.jpg`;
      const { error } = await supabase.storage
        .from(LISTING_PHOTOS_BUCKET)
        .upload(path, buffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });
      if (error) throw new Error(error.message);
      uploaded.push(path);
      onProgress?.({ completed: index + 1, total: uris.length });
    }
    return uploaded;
  } catch (error) {
    await cleanupListingPhotos(uploaded).catch(() => undefined);
    throw error;
  }
}

export async function cleanupListingPhotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(LISTING_PHOTOS_BUCKET).remove(paths);
  if (error) throw new Error(error.message);
}
