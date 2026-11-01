/**
 * Holds the name typed on the Register screen until the SMS code is confirmed,
 * so the account is created (activated) with that name right after verification.
 * Kept in memory only: on Android the SMS can be auto-detected and sign-in can
 * happen before the user even types the code.
 */
let pendingName: string | null = null;
let justActivated = false;

export function setPendingName(name: string | null) {
  pendingName = name?.trim() || null;
}

export function takePendingName(): string | null {
  const n = pendingName;
  pendingName = null;
  return n;
}

export function peekPendingName(): string | null {
  return pendingName;
}

export function markActivated() {
  justActivated = true;
}

/** True once, right after a brand-new account was activated (to show a welcome message). */
export function consumeJustActivated(): boolean {
  const v = justActivated;
  justActivated = false;
  return v;
}
