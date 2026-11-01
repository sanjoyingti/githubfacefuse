// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'functions/*'],
  },
  {
    // Plain apostrophes/quotes in <Text> are fine in React Native.
    rules: { 'react/no-unescaped-entities': 'off' },
  },
]);
