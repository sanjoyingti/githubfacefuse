import { DEFAULT_COUNTRY_CODE } from '../theme';

/** Normalise any user/contacts-entered number to E.164 ("+919876543210"). Returns null if unusable. */
export function normalizePhone(raw: string, defaultCode = DEFAULT_COUNTRY_CODE): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    s = s.replace(/^0+/, '');
    s = defaultCode + s;
  }
  const digits = s.slice(1);
  if (!/^\d{8,15}$/.test(digits)) return null;
  return '+' + digits;
}

export function formatPhone(e164: string): string {
  if (e164.startsWith('+91') && e164.length === 13) {
    return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
  }
  return e164;
}
