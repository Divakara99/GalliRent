const { getDefaultConfig } = require('expo/metro-config');

/** Android-only Expo configuration. No web/PWA bundler target is configured. */
const config = getDefaultConfig(__dirname);

module.exports = config;
