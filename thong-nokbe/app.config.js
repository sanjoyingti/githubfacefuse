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

module.exports = ({ config }) => ({
  ...config,
  extra: { ...(config.extra ?? {}), googleWebClientId: googleWebClientId() },
});
