// Sends "New version available" to every phone with the app (Firebase Cloud Messaging topic
// 'app-updates'), even when the app is closed. Run by the GitHub build when an update is sent out.
//
// Env: FIREBASE_SERVICE_ACCOUNT (the service-account JSON, a GitHub secret), BUILD, NOTES, APK_URL.
// Usage: node scripts/announce-update.mjs            (or --dry-run to print the message only)
import { createSign } from 'node:crypto';

const dry = process.argv.includes('--dry-run');
const build = Number(process.env.BUILD);
const notes = (process.env.NOTES || '').trim();
const url = process.env.APK_URL;
if (!build || !url) throw new Error('BUILD and APK_URL are required');

const message = {
  topic: 'app-updates',
  notification: {
    title: `🎉 Thong Nokbe Gym 1.0.${build} available`,
    body: notes ? `${notes}\nTap to update.` : 'A new version is ready. Tap to update.',
  },
  data: { kind: 'update', build: String(build), url },
  android: { priority: 'high', notification: { channel_id: 'updates', sound: 'default', tag: 'app-update' } },
};

if (dry) {
  console.log(JSON.stringify({ message }, null, 2));
  process.exit(0);
}

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.log('::warning::FIREBASE_SERVICE_ACCOUNT secret is not set, so no update notification was sent (the in-app update box still works).');
  process.exit(0);
}
const sa = JSON.parse(raw);

const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/firebase.messaging',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
})}`;
const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url')}`;

const tok = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
}).then((r) => r.json());
if (!tok.access_token) throw new Error(`Google sign-in for the service account failed: ${tok.error ?? 'unknown'} ${tok.error_description ?? ''}`);

const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
  method: 'POST',
  headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ message }),
});
const out = await res.text();
if (!res.ok) throw new Error(`Sending the update notification failed (${res.status}): ${out}`);
console.log(`Update notification for build ${build} sent to everyone: ${out}`);
