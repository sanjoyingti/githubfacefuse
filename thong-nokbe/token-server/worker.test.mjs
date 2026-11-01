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

test('invite link page: opens the app on Android, offers the APK download, rejects bad codes', async () => {
  const res = await handle(new Request('https://x.workers.dev/join/AbCdEfGhJkMn2345'), env, fakeFetch({}));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /intent:\/\/join\/AbCdEfGhJkMn2345#Intent;scheme=thongnokbe;package=com.thongnokbe.app/);
  assert.match(html, /releases\/download\/thong-nokbe-latest\/ThongNokbeGym.apk/);
  const bad = await handle(new Request('https://x.workers.dev/join/<script>'), env, fakeFetch({}));
  assert.match(await bad.text(), /"ok":true/);
  const app = await handle(new Request('https://x.workers.dev/app'), env, fakeFetch({}));
  assert.equal(app.status, 302);
});

// ---- push notifications (/notify) ----
const sa = await (async () => {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  return { project_id: PROJECT, client_email: 'svc@x.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n` };
})();
const envPush = { ...env, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) };
const S = (v) => ({ stringValue: v });
const A = (xs) => ({ arrayValue: { values: xs.map(S) } });
function pushFetch(docs, sentLog) {
  return async (url, init) => {
    if (url.includes('googleapis.com/service_accounts')) return Response.json({ keys: [jwk] });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'ya29.test' });
    if (url.includes('fcm.googleapis.com')) {
      sentLog.push(JSON.parse(init.body).message);
      return Response.json({ name: 'ok' });
    }
    const m = url.match(/documents\/(.+)$/);
    if (m) {
      const d = docs[m[1]];
      return d && init?.headers?.authorization ? Response.json({ fields: d }) : new Response('{}', { status: 403 });
    }
    return new Response('nf', { status: 404 });
  };
}
const notify = (body, token) =>
  new Request('https://x.workers.dev/notify', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

test('notify call: rings only the people still being rung, with the ringtone channel', async () => {
  const sent = [];
  const docs = {
    'calls/Call0000000000000001': { callerId: S('alice'), callerName: S('Alice'), chatName: S('Gym'), chatId: S('g1'), kind: S('video'), status: S('ringing'), ringingFor: A(['bob', 'carol']) },
    'users/bob': { pushTokens: A(['tokB']) },
    'users/carol': { pushTokens: A(['tokC1', 'tokC2']), appInstalled: { booleanValue: true } },
  };
  const res = await handle(notify({ kind: 'call', callId: 'Call0000000000000001' }, await idToken({})), envPush, pushFetch(docs, sent));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sent: 3, failed: 0 });
  assert.deepEqual(sent.map((m) => m.token).sort(), ['tokB', 'tokC1', 'tokC2']);
  assert.equal(sent[0].android.notification.channel_id, 'calls');
  assert.equal(sent[0].android.notification.sound, 'ringtone');
  assert.equal(sent[0].data.kind, 'call');
  assert.match(sent[0].notification.title, /Alice/);
});

test('notify call: only the caller can ring; ended calls and outsiders refused', async () => {
  const sent = [];
  const docs = { 'calls/Call0000000000000001': { callerId: S('mallory'), ringingFor: A(['bob']), status: S('ringing') } };
  assert.equal((await handle(notify({ kind: 'call', callId: 'Call0000000000000001' }, await idToken({})), envPush, pushFetch(docs, sent))).status, 403);
  assert.equal((await handle(notify({ kind: 'call', callId: 'NotVisible0000000001' }, await idToken({})), envPush, pushFetch(docs, sent))).status, 403);
  docs['calls/Call0000000000000001'] = { callerId: S('alice'), ringingFor: A(['bob']), status: S('ended') };
  assert.equal((await handle(notify({ kind: 'call', callId: 'Call0000000000000001' }, await idToken({})), envPush, pushFetch(docs, sent))).status, 410);
  assert.equal(sent.length, 0);
  assert.equal((await handle(notify({ kind: 'call', callId: 'Call0000000000000001' }, await idToken({})), env, pushFetch(docs, sent))).status, 501);
});

test('notify message: tells the other members about my latest message only', async () => {
  const sent = [];
  const docs = {
    'chats/GroupChat0000000001': {
      type: S('group'), name: S('Iron Gym'), members: A(['alice', 'bob']),
      lastMessage: { mapValue: { fields: { senderId: S('alice'), senderName: S('Alice'), text: S('📢 Fee notice: pay by the 1st') } } },
    },
    'users/bob': { pushTokens: A(['tokB']) },
  };
  const res = await handle(notify({ kind: 'message', chatId: 'GroupChat0000000001' }, await idToken({})), envPush, pushFetch(docs, sent));
  assert.deepEqual(await res.json(), { sent: 1, failed: 0 });
  assert.equal(sent[0].notification.title, 'Iron Gym');
  assert.match(sent[0].notification.body, /Alice: 📢 Fee notice/);
  // someone else's message → refused; not a member → refused
  docs['chats/GroupChat0000000001'].lastMessage.mapValue.fields.senderId = S('bob');
  assert.equal((await handle(notify({ kind: 'message', chatId: 'GroupChat0000000001' }, await idToken({})), envPush, pushFetch(docs, sent))).status, 409);
  docs['chats/GroupChat0000000001'].members = A(['bob']);
  assert.equal((await handle(notify({ kind: 'message', chatId: 'GroupChat0000000001' }, await idToken({})), envPush, pushFetch(docs, sent))).status, 403);
});
