module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    // SDK 50+ enables the Expo Router transforms inside babel-preset-expo,
    // so the legacy 'expo-router/babel' plugin must not be added again.
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: ['react-native-worklets/plugin'],
  };
};
