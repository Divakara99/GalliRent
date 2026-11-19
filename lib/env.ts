function required(name: string, value: string | undefined): string {
  const resolved = value?.trim();
  if (!resolved) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and set your public project values before starting the native app.`,
    );
  }
  return resolved;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export const SUPABASE_URL = required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

/** Build-time Android AdMob app ID is injected into AndroidManifest by app.config.js. */
export const ADMOB_ANDROID_APP_ID = optional('EXPO_PUBLIC_ADMOB_ANDROID_APP_ID');
export const DEV_BANNER_UNIT_ID = optional('EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID');
export const DEV_REWARDED_UNIT_ID = optional('EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID');
export const TERMS_URL = optional('EXPO_PUBLIC_TERMS_URL');

export const IS_DEV = typeof __DEV__ === 'boolean' ? __DEV__ : process.env.NODE_ENV !== 'production';
