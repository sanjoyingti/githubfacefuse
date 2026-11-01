import { Linking, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import type { UpiSettings } from './types';

export interface UpiResult {
  /** success: the UPI app reported SUCCESS. failed: reported failure/cancel. unknown: app returned nothing (iOS or some apps). */
  outcome: 'success' | 'failed' | 'unknown';
  txnId?: string;
  raw?: string;
}

/** Unique transaction reference passed to the UPI app (max 35 chars, alphanumeric). */
export function makeTxnRef(...parts: string[]) {
  return ('TN' + parts.map((p) => p.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)).join('') + Date.now().toString(36)).slice(0, 35);
}

export function isValidVpa(vpa: string) {
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/.test(vpa.trim());
}

export function buildUpiUrl(upi: UpiSettings, opts: { note: string; ref: string; scheme?: string }) {
  const params = new URLSearchParams({
    pa: upi.vpa.trim(),
    pn: upi.payeeName.trim(),
    am: upi.amount.toFixed(2),
    cu: 'INR',
    tn: opts.note.slice(0, 80),
    tr: opts.ref,
  });
  return `${opts.scheme ?? 'upi://pay'}?${params.toString()}`;
}

/** Parses the "response" string UPI apps return, e.g. "txnId=..&responseCode=00&Status=SUCCESS&txnRef=..". */
export function parseUpiResponse(raw: string | undefined | null): UpiResult {
  if (!raw) return { outcome: 'unknown' };
  const map: Record<string, string> = {};
  for (const part of raw.split('&')) {
    const [k, ...v] = part.split('=');
    if (k) map[k.trim().toLowerCase()] = decodeURIComponent(v.join('=') || '').trim();
  }
  const status = (map.status || '').toUpperCase();
  const txnId = map.txnid || map.approvalrefno || map.txnref || undefined;
  if (status === 'SUCCESS' || status === 'SUBMITTED') return { outcome: 'success', txnId, raw };
  if (status) return { outcome: 'failed', txnId, raw };
  return { outcome: 'unknown', raw };
}

// iOS cannot use the generic upi:// chooser reliably, so offer the popular apps by scheme.
export const IOS_UPI_APPS = [
  { name: 'Google Pay', scheme: 'gpay://upi/pay' },
  { name: 'PhonePe', scheme: 'phonepe://pay' },
  { name: 'Paytm', scheme: 'paytmmp://pay' },
  { name: 'BHIM', scheme: 'bhim://pay' },
  { name: 'Any UPI app', scheme: 'upi://pay' },
];

/**
 * Opens a UPI app to pay the admin. On Android we launch the intent "for result",
 * so the app tells us whether the payment succeeded and gives the transaction id.
 */
export async function payWithUpi(upi: UpiSettings, opts: { note: string; ref: string; iosScheme?: string }): Promise<UpiResult> {
  if (Platform.OS === 'android') {
    const url = buildUpiUrl(upi, opts);
    const res = await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: url });
    const extra = (res.extra ?? {}) as Record<string, unknown>;
    const raw = (extra.response as string) ?? (extra.Status ? `Status=${extra.Status}&txnId=${extra.txnId ?? ''}` : undefined);
    const parsed = parseUpiResponse(raw);
    if (parsed.outcome === 'unknown' && res.resultCode === IntentLauncher.ResultCode.Canceled) {
      // Many apps return RESULT_CANCELED even after paying, so stay "unknown" and let the user confirm.
      return { outcome: 'unknown' };
    }
    return parsed;
  }
  const url = buildUpiUrl(upi, { ...opts, scheme: opts.iosScheme });
  await Linking.openURL(url);
  return { outcome: 'unknown' };
}
