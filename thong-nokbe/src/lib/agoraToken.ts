/**
 * Builds an Agora RTC "AccessToken2" (version 007) on the phone, so calls work
 * on Agora projects that require tokens without running a paid server.
 * Same format as Agora's official agora-token package (RtcTokenBuilder2.buildTokenWithUid).
 */
import HmacSHA256 from 'crypto-js/hmac-sha256';
import WordArray from 'crypto-js/lib-typedarrays';
import { deflate } from 'pako';

type CryptoWordArray = ReturnType<typeof WordArray.create>;

function toWordArray(bytes: Uint8Array): CryptoWordArray {
  return WordArray.create(bytes as unknown as number[]);
}

function fromWordArray(wa: { words: number[]; sigBytes: number }): Uint8Array {
  const out = new Uint8Array(wa.sigBytes);
  for (let i = 0; i < wa.sigBytes; i++) out[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  return out;
}

function hmac(key: Uint8Array, message: Uint8Array): Uint8Array {
  return fromWordArray(HmacSHA256(toWordArray(message), toWordArray(key)) as unknown as { words: number[]; sigBytes: number });
}

const utf8 = (s: string) => new TextEncoder().encode(s);

class Writer {
  private parts: number[] = [];
  u16(v: number) {
    this.parts.push(v & 0xff, (v >>> 8) & 0xff);
    return this;
  }
  u32(v: number) {
    this.parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  bytes(b: Uint8Array) {
    this.u16(b.length);
    for (const x of b) this.parts.push(x);
    return this;
  }
  str(s: string) {
    return this.bytes(utf8(s));
  }
  raw(b: Uint8Array) {
    for (const x of b) this.parts.push(x);
    return this;
  }
  done() {
    return Uint8Array.from(this.parts);
  }
}

function base64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += chars[(n >>> 18) & 63] + chars[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? chars[(n >>> 6) & 63] : '=';
    out += i + 2 < bytes.length ? chars[n & 63] : '=';
  }
  return out;
}

export interface TokenOptions {
  appId: string;
  appCertificate: string;
  channel: string;
  uid: number;
  /** Seconds the token stays valid. */
  expireSeconds?: number;
  /** For tests only. */
  issueTs?: number;
  salt?: number;
}

/** Publisher token (join + publish audio/video/data) for one channel and uid. */
export function buildRtcToken({ appId, appCertificate, channel, uid, expireSeconds = 7200, issueTs, salt }: TokenOptions): string {
  const ts = issueTs ?? Math.floor(Date.now() / 1000);
  const s = salt ?? Math.floor(Math.random() * 99999999) + 1;

  let signingKey = hmac(new Writer().u32(ts).done(), utf8(appCertificate));
  signingKey = hmac(new Writer().u32(s).done(), signingKey);

  // RTC service (type 1) with privileges join(1), publish audio(2), video(3), data(4).
  const service = new Writer()
    .u16(1)
    .u16(4)
    .u16(1).u32(expireSeconds)
    .u16(2).u32(expireSeconds)
    .u16(3).u32(expireSeconds)
    .u16(4).u32(expireSeconds)
    .str(channel)
    .str(uid === 0 ? '' : String(uid))
    .done();

  const signingInfo = new Writer().str(appId).u32(ts).u32(expireSeconds).u32(s).u16(1).raw(service).done();
  const signature = hmac(signingKey, signingInfo);
  const content = new Writer().bytes(signature).raw(signingInfo).done();
  return '007' + base64(deflate(content));
}
