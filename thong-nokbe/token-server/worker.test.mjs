// Run: node --test token-server/worker.test.mjs   (Node 20+)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { agoraUid, buildRtcToken, handle } from './worker.js';

// Reference output from Agora's official agora-token package (same inputs), as inflated hex.
const GOLDEN =
  '200073daf932ecb10bf68f2b7b5429268418782c961af256d0521f884652f1a6897820003031323334353637383961626364656630313233343536373839616263646566803bb16a201c00004e61bc000100010004000100201c00000200201c00000300201c00000400201c000014004162436445663031323334353637383978797a510900393837363534333231';

test('token matches the official Agora AccessToken2 format', async () => {
  const tok = await buildRtcToken({
    appId: '0123456789abcdef0123456789abcdef',
    appCertificate: 'fedcba9876543210fedcba9876543210',
    channel: 'AbCdEf0123456789xyzQ',
    uid: 987654321,
    issueTs: 1790000000,
    salt: 12345678,
  });
  assert.ok(tok.startsWith('007'));
  assert.equal(inflateSync(Buffer.from(tok.slice(3), 'base64')).toString('hex'), GOLDEN);
});

// ---- fake Google keys + Firestore ----
const PROJECT = 'roid-266a2';
const env = { AGORA_APP_ID: '0123456789abcdef0123456789abcdef', AGORA_APP_CERTIFICATE: 'fedcba9876543210fedcba9876543210', FIREBASE_PROJECT_ID: PROJECT };
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64url = (b) => Buffer.from(b).toString('base64url');
async function idToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64url(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'alice', iat: now, exp: now + 3600, ...claims }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}
function fakeFetch(callDocs) {
  return async (url, init) => {
    if (url.includes('googleapis.com/service_accounts')) return Response.json({ keys: [jwk] });
    const m = url.match(/documents\/calls\/(\w+)$/);
    if (m) {
      const doc = callDocs[m[1]];
      if (!doc || !init?.headers?.authorization) return new Response('{}', { status: 403 });
      return Response.json({ fields: { status: { stringValue: doc.status } } });
    }
    return new Response('not found', { status: 404 });
  };
}
const post = (body, token) =>
  new Request('https://x.workers.dev/', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });

test('gives a pass to a signed-in person who is in a live call', async () => {
  const res = await handle(post({ channel: 'Call0000000000000001' }, await idToken({})), env, fakeFetch({ Call0000000000000001: { status: 'ringing' } }));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.appId, env.AGORA_APP_ID);
  assert.equal(j.uid, agoraUid('alice'));
  assert.ok(j.token.startsWith('007'));
});

test('refuses: not signed in, forged/expired/other-project tokens, not in call, ended call, bad channel', async () => {
  const f = fakeFetch({ Call0000000000000001: { status: 'ongoing' }, Ended000000000000001: { status: 'ended' } });
  const ch = { channel: 'Call0000000000000001' };
  assert.equal((await handle(post(ch), env, f)).status, 401);
  const good = await idToken({});
  const forged = good.slice(0, -4) + (good.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.equal((await handle(post(ch, forged), env, f)).status, 401);
  assert.equal((await handle(post(ch, await idToken({ exp: 1000 })), env, f)).status, 401);
  assert.equal((await handle(post(ch, await idToken({ aud: 'other-project', iss: 'https://securetoken.google.com/other-project' })), env, f)).status, 401);
  assert.equal((await handle(post({ channel: 'NotMyCall00000000001' }, good), env, f)).status, 403);
  assert.equal((await handle(post({ channel: 'Ended000000000000001' }, good), env, f)).status, 410);
  assert.equal((await handle(post({ channel: '../etc' }, good), env, f)).status, 400);
});

test('refuses when the server is not configured', async () => {
  const res = await handle(post({ channel: 'Call0000000000000001' }, await idToken({})), {}, fakeFetch({}));
  assert.equal(res.status, 500);
});
