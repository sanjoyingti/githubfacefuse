/**
 * Thong Nokbe Gym – call pass (Agora token) server for Cloudflare Workers (free plan).
 *
 * Keeps the Agora Primary Certificate secret. A pass is only given when:
 *   1. the request carries a valid Firebase sign-in token for this Firebase project, and
 *   2. that signed-in person can read the call in Firestore (the security rules allow only
 *      the caller and the people invited to that call), and the call hasn't ended.
 *
 * Settings → Variables and Secrets (Cloudflare dashboard):
 *   AGORA_APP_ID          (Text)    your Agora App ID
 *   AGORA_APP_CERTIFICATE (Secret)  your Agora Primary Certificate
 *   FIREBASE_PROJECT_ID   (Text)    e.g. roid-266a2
 *
 * Request:  POST /  { "channel": "<callId>" }   with header  Authorization: Bearer <Firebase ID token>
 * Response: { "appId": "...", "token": "007...", "uid": 123 }
 */

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const enc = new TextEncoder();

// ---------- helpers ----------
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Same numeric id the app uses for each person in a call room. */
export function agoraUid(uid) {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

// ---------- Firebase ID token check (RS256, Google's public keys) ----------
let jwksCache = { keys: null, until: 0 };

async function googleKeys(fetchFn) {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetchFn(JWKS_URL);
  if (!res.ok) throw new Error('could not load Google keys');
  const { keys } = await res.json();
  jwksCache = { keys, until: Date.now() + 60 * 60 * 1000 };
  return keys;
}

export async function verifyFirebaseIdToken(idToken, projectId, fetchFn = fetch, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('bad token');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  if (header.alg !== 'RS256') throw new Error('bad alg');
  const jwk = (await googleKeys(fetchFn)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('bad signature');
  if (payload.aud !== projectId) throw new Error('wrong project');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('wrong issuer');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('no user');
  if (!(payload.exp > nowSec) || !(payload.iat <= nowSec + 300)) throw new Error('expired');
  return payload.sub;
}

// ---------- Agora AccessToken2 (version 007), RTC publisher ----------
class Writer {
  constructor() {
    this.parts = [];
  }
  u16(v) {
    this.parts.push(Uint8Array.of(v & 0xff, (v >>> 8) & 0xff));
    return this;
  }
  u32(v) {
    this.parts.push(Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff));
    return this;
  }
  bytes(b) {
    this.u16(b.length);
    this.parts.push(b);
    return this;
  }
  str(s) {
    return this.bytes(enc.encode(s));
  }
  raw(b) {
    this.parts.push(b);
    return this;
  }
  done() {
    return concat(...this.parts);
  }
}

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
}

async function zlibDeflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function buildRtcToken({ appId, appCertificate, channel, uid, expireSeconds = 7200, issueTs, salt }) {
  const ts = issueTs ?? Math.floor(Date.now() / 1000);
  const s = salt ?? Math.floor(Math.random() * 99999999) + 1;
  let signing = await hmac(new Writer().u32(ts).done(), enc.encode(appCertificate));
  signing = await hmac(new Writer().u32(s).done(), signing);
  const service = new Writer()
    .u16(1) // RTC
    .u16(4)
    .u16(1).u32(expireSeconds) // join channel
    .u16(2).u32(expireSeconds) // publish audio
    .u16(3).u32(expireSeconds) // publish video
    .u16(4).u32(expireSeconds) // publish data
    .str(channel)
    .str(uid === 0 ? '' : String(uid))
    .done();
  const signingInfo = new Writer().str(appId).u32(ts).u32(expireSeconds).u32(s).u16(1).raw(service).done();
  const signature = await hmac(signing, signingInfo);
  const content = new Writer().bytes(signature).raw(signingInfo).done();
  return '007' + bytesToB64(await zlibDeflate(content));
}

// ---------- request handler ----------
export async function handle(request, env, fetchFn = fetch) {
  if (request.method === 'OPTIONS') return json({}, 204);
  if (request.method === 'GET') return json({ ok: true, service: 'Thong Nokbe Gym call pass server' });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!env.AGORA_APP_ID || !env.AGORA_APP_CERTIFICATE || !env.FIREBASE_PROJECT_ID)
    return json({ error: 'Server is missing AGORA_APP_ID, AGORA_APP_CERTIFICATE or FIREBASE_PROJECT_ID' }, 500);

  const auth = request.headers.get('authorization') || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!idToken) return json({ error: 'sign in first' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const channel = typeof body?.channel === 'string' ? body.channel : '';
  if (!/^[A-Za-z0-9]{10,64}$/.test(channel)) return json({ error: 'bad channel' }, 400);

  let userId;
  try {
    userId = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID, fetchFn);
  } catch (e) {
    return json({ error: 'not signed in: ' + e.message }, 401);
  }

  // Ask Firestore, as this user, for the call. The security rules only let the caller and the
  // invited people read it, so a successful read proves the person belongs in this call.
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/calls/${channel}`;
  const res = await fetchFn(url, { headers: { authorization: `Bearer ${idToken}` } });
  if (res.status === 403 || res.status === 404) return json({ error: 'not part of this call' }, 403);
  if (!res.ok) return json({ error: 'could not check the call' }, 502);
  const doc = await res.json();
  if (doc?.fields?.status?.stringValue === 'ended') return json({ error: 'this call has ended' }, 410);

  const uid = agoraUid(userId);
  const token = await buildRtcToken({ appId: env.AGORA_APP_ID, appCertificate: env.AGORA_APP_CERTIFICATE, channel, uid });
  return json({ appId: env.AGORA_APP_ID, token, uid });
}

export default {
  fetch: (request, env) => handle(request, env),
};
