import { supabase } from './supabase';

export const LISTING_PHOTOS_BUCKET = 'listing-photos';

export function listingPhotoUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return supabase.storage.from(LISTING_PHOTOS_BUCKET).getPublicUrl(pathOrUrl).data.publicUrl;
}
