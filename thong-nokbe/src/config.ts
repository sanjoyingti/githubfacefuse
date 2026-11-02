// Address of the free "call pass" server (Cloudflare Worker, see token-server/ and SETUP-GUIDE Part B).
// It is not a secret: the server only gives passes to signed-in people who are part of a call.
export const CALL_SERVER_URL = process.env.EXPO_PUBLIC_CALL_SERVER_URL ?? 'https://thong-nokbe-calls.samaengti.workers.dev';
// Link shared with contacts who don't have the app yet.
export const APP_INVITE_LINK =
  process.env.EXPO_PUBLIC_INVITE_LINK ?? 'https://github.com/sanjoyingti/githubfacefuse/releases/download/thong-nokbe-latest/ThongNokbeGym.apk';

/** Small file published with each update sent to everyone: {"build": 25, "notes": "...", "url": "<apk>"}. */
export const UPDATE_INFO_URL = process.env.EXPO_PUBLIC_UPDATE_INFO_URL ?? 'https://github.com/sanjoyingti/githubfacefuse/releases/download/thong-nokbe-latest/version.json';
