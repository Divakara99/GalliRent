import { Linking } from 'react-native';

import { normalizeIndianPhone } from './format';

export async function openExternal(url: string, failureMessage = 'Unable to open this link.'): Promise<void> {
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      const fallback = url.startsWith('https://wa.me/')
        ? `https://api.whatsapp.com/send?phone=${url.split('/').pop()}`
        : url;
      await Linking.openURL(fallback);
      return;
    }
    await Linking.openURL(url);
  } catch {
    throw new Error(failureMessage);
  }
}

export function callOwner(phone: string): Promise<void> {
  return openExternal(`tel:+91${normalizeIndianPhone(phone)}`, 'No phone dialer is available on this device.');
}

export function whatsappOwner(phone: string): Promise<void> {
  return openExternal(`https://wa.me/91${normalizeIndianPhone(phone)}`, 'WhatsApp is not available on this device.');
}

export function openInGoogleMaps(lat: number | string, lng: number | string): Promise<void> {
  const destination = encodeURIComponent(`${lat},${lng}`);
  return openExternal(
    `https://www.google.com/maps/dir/?api=1&destination=${destination}`,
    'Google Maps could not be opened.',
  );
}
