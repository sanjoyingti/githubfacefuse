const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const enc = new TextEncoder();
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
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
function agoraUid(uid) {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483646 + 1;
}
let jwksCache = { keys: null, until: 0 };
async function googleKeys(fetchFn) {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetchFn(JWKS_URL);
  if (!res.ok) throw new Error("could not load Google keys");
  const { keys } = await res.json();
  jwksCache = { keys, until: Date.now() + 60 * 60 * 1e3 };
  return keys;
}
async function verifyFirebaseIdToken(idToken, projectId, fetchFn = fetch, nowSec = Math.floor(Date.now() / 1e3)) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  if (header.alg !== "RS256") throw new Error("bad alg");
  const jwk = (await googleKeys(fetchFn)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  if (!ok) throw new Error("bad signature");
  if (payload.aud !== projectId) throw new Error("wrong project");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("wrong issuer");
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("no user");
  if (!(payload.exp > nowSec) || !(payload.iat <= nowSec + 300)) throw new Error("expired");
  return payload.sub;
}
class Writer {
  constructor() {
    this.parts = [];
  }
  u16(v) {
    this.parts.push(Uint8Array.of(v & 255, v >>> 8 & 255));
    return this;
  }
  u32(v) {
    this.parts.push(Uint8Array.of(v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255));
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
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, msg));
}
async function zlibDeflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function buildRtcToken({ appId, appCertificate, channel, uid, expireSeconds = 7200, issueTs, salt }) {
  const ts = issueTs ?? Math.floor(Date.now() / 1e3);
  const s = salt ?? Math.floor(Math.random() * 99999999) + 1;
  let signing = await hmac(new Writer().u32(ts).done(), enc.encode(appCertificate));
  signing = await hmac(new Writer().u32(s).done(), signing);
  const service = new Writer().u16(1).u16(4).u16(1).u32(expireSeconds).u16(2).u32(expireSeconds).u16(3).u32(expireSeconds).u16(4).u32(expireSeconds).str(channel).str(uid === 0 ? "" : String(uid)).done();
  const signingInfo = new Writer().str(appId).u32(ts).u32(expireSeconds).u32(s).u16(1).raw(service).done();
  const signature = await hmac(signing, signingInfo);
  const content = new Writer().bytes(signature).raw(signingInfo).done();
  return "007" + bytesToB64(await zlibDeflate(content));
}
const APK_URL = "https://github.com/sanjoyingti/githubfacefuse/releases/download/thong-nokbe-latest/ThongNokbeGym.apk";
function invitePage(code) {
  const appLink = `thongnokbe://join/${code}`;
  const intentLink = `intent://join/${code}#Intent;scheme=thongnokbe;package=com.thongnokbe.app;S.browser_fallback_url=${encodeURIComponent(APK_URL)};end`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join my gym group on Thong Nokbe Gym</title>
<meta property="og:title" content="Join my gym group on Thong Nokbe Gym">
<meta property="og:description" content="Tap to join the group: workouts, chat, calls, attendance and fees.">
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0e1512;color:#f1f5f9;display:flex;min-height:100vh;align-items:center;justify-content:center}
.c{max-width:420px;padding:28px;text-align:center}
h1{font-size:26px;margin:12px 0 6px}p{color:#94a3b8;font-size:16px;line-height:1.5}
a.b{display:block;margin:14px 0;padding:16px;border-radius:30px;font-size:18px;font-weight:800;text-decoration:none}
.join{background:#22c55e;color:#fff}.dl{border:2px solid #22c55e;color:#22c55e}
.s{font-size:13px;color:#64748b;margin-top:22px}
</style></head><body><div class="c">
<div style="font-size:64px">\u{1F3CB}\uFE0F</div>
<h1>You're invited!</h1>
<p>Join my gym group on <b>Thong Nokbe Gym</b>.</p>
<a class="b join" href="${intentLink}" id="open">\u2705 Open in the app &amp; join</a>
<a class="b dl" href="${APK_URL}">\u2B07\uFE0F Don't have the app? Download it</a>
<p class="s">After installing, sign in, then tap the invite link again to join.</p>
</div>
<script>
var ua=navigator.userAgent||'';
if(!/Android/i.test(ua)){document.getElementById('open').href=${JSON.stringify(appLink)};}
<\/script>
</body></html>`;
}
let googleToken = { value: null, until: 0 };
function b64url(bytes) {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function googleAccessToken(serviceAccount, fetchFn) {
  if (googleToken.value && Date.now() < googleToken.until) return googleToken.value;
  const now = Math.floor(Date.now() / 1e3);
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600
      })
    )
  );
  const pem = serviceAccount.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claims}`)));
  const res = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${header}.${claims}.${b64url(sig)}`
  });
  if (!res.ok) throw new Error("google auth failed");
  const j = await res.json();
  googleToken = { value: j.access_token, until: Date.now() + 50 * 60 * 1e3 };
  return j.access_token;
}
const fsStr = (f, k) => f?.[k]?.stringValue ?? "";
const fsBool = (f, k) => f?.[k]?.booleanValue;
const fsArr = (f, k) => (f?.[k]?.arrayValue?.values ?? []).map((v) => v.stringValue).filter(Boolean);
async function readDoc(env, path, idToken, fetchFn) {
  const res = await fetchFn(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, {
    headers: { authorization: `Bearer ${idToken}` }
  });
  if (!res.ok) return null;
  return (await res.json()).fields ?? {};
}
async function pushTokensFor(env, uids, idToken, fetchFn) {
  const docs = await Promise.all(uids.slice(0, 100).map((u) => readDoc(env, `users/${u}`, idToken, fetchFn)));
  return docs.flatMap((f) => f && fsBool(f, "appInstalled") !== false ? fsArr(f, "pushTokens") : []);
}
async function sendPush(env, tokens, build, fetchFn) {
  if (!tokens.length) return { sent: 0, failed: 0 };
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const access = await googleAccessToken(sa, fetchFn);
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id || env.FIREBASE_PROJECT_ID}/messages:send`;
  let sent = 0, failed = 0;
  await Promise.all(
    [...new Set(tokens)].map(async (token) => {
      const r = await fetchFn(url, {
        method: "POST",
        headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
        body: JSON.stringify({ message: build(token) })
      });
      r.ok ? sent++ : failed++;
    })
  );
  return { sent, failed };
}
async function handleNotify(body, userId, idToken, env, fetchFn) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return json({ error: "push not set up (FIREBASE_SERVICE_ACCOUNT missing)" }, 501);
  if (body?.kind === "call") {
    const callId = String(body.callId || "");
    if (!/^[A-Za-z0-9]{10,64}$/.test(callId)) return json({ error: "bad call" }, 400);
    const call = await readDoc(env, `calls/${callId}`, idToken, fetchFn);
    if (!call) return json({ error: "not part of this call" }, 403);
    if (fsStr(call, "callerId") !== userId) return json({ error: "only the caller can ring" }, 403);
    if (fsStr(call, "status") === "ended") return json({ error: "call ended" }, 410);
    const video = fsStr(call, "kind") !== "voice";
    const isGroup = !!fsBool(call, "isGroup");
    const title = `${video ? "\u{1F4F9}" : "\u{1F4DE}"} ${isGroup ? fsStr(call, "chatName") : fsStr(call, "callerName")}`;
    const text = isGroup ? `${fsStr(call, "callerName")} started a group ${video ? "video" : "voice"} call. Tap to join` : `Incoming ${video ? "video" : "voice"} call. Tap to answer`;
    const tokens = await pushTokensFor(env, fsArr(call, "ringingFor"), idToken, fetchFn);
    const r = await sendPush(env, tokens, (token) => ({
      token,
      notification: { title, body: text },
      data: { kind: "call", callId, chatId: fsStr(call, "chatId") },
      android: {
        priority: "HIGH",
        ttl: "45s",
        notification: { channel_id: "calls", sound: "ringtone", tag: callId, notification_priority: "PRIORITY_MAX", visibility: "PUBLIC" }
      }
    }), fetchFn);
    return json(r);
  }
  if (body?.kind === "message") {
    const chatId = String(body.chatId || "");
    if (!/^[A-Za-z0-9_]{10,140}$/.test(chatId)) return json({ error: "bad chat" }, 400);
    const chat = await readDoc(env, `chats/${chatId}`, idToken, fetchFn);
    if (!chat || !fsArr(chat, "members").includes(userId)) return json({ error: "not in this chat" }, 403);
    const last = chat.lastMessage?.mapValue?.fields;
    if (!last || fsStr(last, "senderId") !== userId) return json({ error: "nothing new from you" }, 409);
    const isGroup = fsStr(chat, "type") === "group";
    const sender = fsStr(last, "senderName");
    const msg = fsStr(last, "text");
    const title = isGroup ? fsStr(chat, "name") : sender;
    const text = (isGroup ? `${sender}: ${msg}` : msg).slice(0, 300);
    const others = fsArr(chat, "members").filter((u) => u !== userId);
    const tokens = await pushTokensFor(env, others, idToken, fetchFn);
    const r = await sendPush(env, tokens, (token) => ({
      token,
      notification: { title, body: text },
      data: { kind: "message", chatId },
      android: { priority: "HIGH", notification: { channel_id: "messages", tag: chatId, visibility: "PRIVATE" } }
    }), fetchFn);
    return json(r);
  }
  return json({ error: "bad kind" }, 400);
}
async function handle(request, env, fetchFn = fetch) {
  if (request.method === "OPTIONS") return json({}, 204);
  if (request.method === "GET") {
    const path = new URL(request.url).pathname;
    const m = path.match(/^\/join\/([A-Za-z0-9]{12,32})\/?$/);
    if (m) return new Response(invitePage(m[1]), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (path === "/app") return Response.redirect(APK_URL, 302);
    return json({ ok: true, service: "Thong Nokbe Gym call pass server" });
  }
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!env.AGORA_APP_ID || !env.AGORA_APP_CERTIFICATE || !env.FIREBASE_PROJECT_ID)
    return json({ error: "Server is missing AGORA_APP_ID, AGORA_APP_CERTIFICATE or FIREBASE_PROJECT_ID" }, 500);
  const auth = request.headers.get("authorization") || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!idToken) return json({ error: "sign in first" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }
  let userId;
  try {
    userId = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID, fetchFn);
  } catch (e) {
    return json({ error: "not signed in: " + e.message }, 401);
  }
  if (new URL(request.url).pathname === "/notify") return handleNotify(body, userId, idToken, env, fetchFn);
  const channel = typeof body?.channel === "string" ? body.channel : "";
  if (!/^[A-Za-z0-9]{10,64}$/.test(channel)) return json({ error: "bad channel" }, 400);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/calls/${channel}`;
  const res = await fetchFn(url, { headers: { authorization: `Bearer ${idToken}` } });
  if (res.status === 403 || res.status === 404) return json({ error: "not part of this call" }, 403);
  if (!res.ok) return json({ error: "could not check the call" }, 502);
  const doc = await res.json();
  if (doc?.fields?.status?.stringValue === "ended") return json({ error: "this call has ended" }, 410);
  const uid = agoraUid(userId);
  const token = await buildRtcToken({ appId: env.AGORA_APP_ID, appCertificate: env.AGORA_APP_CERTIFICATE, channel, uid });
  return json({ appId: env.AGORA_APP_ID, token, uid });
}
var worker_default = {
  fetch: (request, env) => handle(request, env)
};
export {
  agoraUid,
  buildRtcToken,
  worker_default as default,
  handle,
  handleNotify,
  invitePage,
  verifyFirebaseIdToken
};
