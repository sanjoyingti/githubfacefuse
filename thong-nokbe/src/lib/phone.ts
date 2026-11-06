import { DEFAULT_COUNTRY_CODE } from '../theme';

/** Normalise any user/contacts-entered number to E.164 ("+919876543210"). Returns null if unusable. */
export function normalizePhone(raw: string, defaultCode = DEFAULT_COUNTRY_CODE): string | null {
  if (!raw) return null;
  // Keep only digits and a leading "+" (contacts often hold spaces, dashes, dots, brackets or odd unicode spaces).
  let s = raw.trim().replace(/[^\d+]/g, '');
  s = s.replace(/(?!^)\+/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    s = s.replace(/^0+/, '');
    const cc = defaultCode.replace('+', ''); // "91"
    // Already has the country code without "+" (e.g. 917002397371): don't add it twice.
    if (s.startsWith(cc) && s.length === cc.length + 10) s = '+' + s;
    else s = defaultCode + s;
  } else if (s.startsWith(defaultCode + '0')) {
    s = defaultCode + s.slice(defaultCode.length).replace(/^0+/, ''); // "+91 0 70023…" → "+9170023…"
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
