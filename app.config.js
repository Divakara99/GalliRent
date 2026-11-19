const SAMPLE_ADMOB_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const PRODUCTION_BUILD =
  process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PROFILE_NAME === 'production';

const admobAndroidAppId =
  process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID ||
  process.env.ADMOB_ANDROID_APP_ID ||
  SAMPLE_ADMOB_APP_ID;

const googleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  'REPLACE_GOOGLE_MAPS_API_KEY';

if (PRODUCTION_BUILD && admobAndroidAppId === SAMPLE_ADMOB_APP_ID) {
  throw new Error(
    'Set EXPO_PUBLIC_ADMOB_ANDROID_APP_ID to your real AdMob Android app ID before a production build. The Google sample app ID is for development only.',
  );
}

if (PRODUCTION_BUILD && googleMapsApiKey.startsWith('REPLACE_')) {
  throw new Error(
    'Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY before a production build; react-native-maps requires an Android Maps SDK key.',
  );
}

/**
 * Single source of truth for the Expo config. This is a dynamic config so the
 * AdMob app ID and Android Maps SDK key can be injected from the build
 * environment instead of being committed to the repository.
 *
 * Android-only on purpose: GalliRent ships as a native Play Store app
 * (in.gallirent.app) and is never built for web/PWA or iOS.
 */
const baseConfig = {
  "name": "GalliRent",
  "slug": "gallirent",
  "version": "1.0.0",
  "orientation": "portrait",
  "userInterfaceStyle": "light",
  "scheme": "gallirent",
  "platforms": [
    "android"
  ],
  "newArchEnabled": true,
  "icon": "./assets/icon.png",
  "assetBundlePatterns": [
    "**/*"
  ],
  "splash": {
    "image": "./assets/splash.png",
    "resizeMode": "contain",
    "backgroundColor": "#1E293B"
  },
  "android": {
    "package": "in.gallirent.app",
    "versionCode": 1,
    "adaptiveIcon": {
      "foregroundImage": "./assets/adaptive-icon.png",
      "backgroundColor": "#047857"
    },
    "allowBackup": false,
    "usesCleartextTraffic": false,
    "softwareKeyboardLayoutMode": "pan",
    "permissions": [
      "android.permission.CAMERA",
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.VIBRATE",
      "com.google.android.gms.permission.AD_ID"
    ],
    "config": {
      "googleMaps": {
        "apiKey": "REPLACE_GOOGLE_MAPS_API_KEY"
      }
    },
    "blockedPermissions": [
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW"
    ]
  },
  "plugins": [
    "expo-router",
    [
      "expo-location",
      {
        "locationWhenInUsePermission": "GalliRent uses your location once to help you choose the approximate area of a property. Exact coordinates are never shown publicly."
      }
    ],
    [
      "expo-image-picker",
      {
        "cameraPermission": "GalliRent needs camera access to snap property photos.",
        "photosPermission": "GalliRent needs photo access so you can upload one to ten property photos."
      }
    ],
    [
      "react-native-google-mobile-ads",
      {
        "androidAppId": "ca-app-pub-3940256099942544~3347511713",
        "delayAppMeasurementInit": true,
        "optimizeInitialization": true,
        "optimizeAdLoading": true
      }
    ],
    "expo-iap",
    [
      "expo-build-properties",
      {
        "android": {
          "compileSdkVersion": 36,
          "targetSdkVersion": 36,
          "minSdkVersion": 23,
          "buildToolsVersion": "36.0.0",
          "enableProguardInReleaseBuilds": true
        }
      }
    ]
  ]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = () => {
  const resolved = clone(baseConfig);

  resolved.android = resolved.android || {};
  resolved.android.config = resolved.android.config || {};
  resolved.android.config.googleMaps = resolved.android.config.googleMaps || {};
  resolved.android.config.googleMaps.apiKey = googleMapsApiKey;

  resolved.plugins = (resolved.plugins || []).map((entry) => {
    if (Array.isArray(entry) && entry[0] === 'react-native-google-mobile-ads') {
      return [
        entry[0],
        {
          ...(entry[1] || {}),
          androidAppId: admobAndroidAppId,
        },
      ];
    }
    return entry;
  });

  resolved.extra = {
    ...(resolved.extra || {}),
    gallirent: {
      androidOnly: true,
      packageName: 'in.gallirent.app',
      admobLiveAppIdConfigured: admobAndroidAppId !== SAMPLE_ADMOB_APP_ID,
    },
  };

  return resolved;
};
