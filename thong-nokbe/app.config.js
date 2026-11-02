// Adds values read from google-services.json to the app config at build time.
const fs = require('fs');
const path = require('path');

function googleWebClientId() {
  try {
    const file = path.join(__dirname, 'google-services.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const client of json.client ?? []) {
      // client_type 3 = the "Web client" OAuth id that Google Sign-In needs to give Firebase an ID token.
      const web = (client.oauth_client ?? []).find((c) => c.client_type === 3);
      if (web) return web.client_id;
    }
  } catch {}
  return '';
}

// Build number from the GitHub build (EXPO_PUBLIC_BUILD_NUMBER): Android needs it to grow with each update.
const build = Number(process.env.EXPO_PUBLIC_BUILD_NUMBER) || 1;

module.exports = ({ config }) => ({
  ...config,
  version: `1.0.${build}`,
  android: { ...(config.android ?? {}), versionCode: build },
  extra: { ...(config.extra ?? {}), googleWebClientId: googleWebClientId() },
});
