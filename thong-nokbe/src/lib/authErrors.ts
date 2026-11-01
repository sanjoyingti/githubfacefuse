import { getApp } from '@react-native-firebase/app';

/** True when the app was built without a real Firebase project (stand-in google-services.json). */
export function isServerNotConnected(): boolean {
  try {
    const key = getApp().options.apiKey ?? '';
    return !key || key.includes('PLACEHOLDER');
  } catch {
    return true;
  }
}

export const NOT_CONNECTED_MESSAGE =
  "This copy of Thong Nokbe Gym isn't connected to its server yet, so sign-in can't work. The gym admin needs to finish the free setup (SETUP-GUIDE) and install the full version of the app.";

/** Turns Firebase sign-in errors into short, plain messages. */
export function friendlyAuthError(e: any): string {
  const code: string = e?.code ?? '';
  const msg: string = e?.message ?? String(e);
  if (/API key not valid|api-key-not-valid|invalid-api-key/i.test(msg) || isServerNotConnected()) return NOT_CONNECTED_MESSAGE;
  if (code === 'auth/invalid-phone-number') return 'That phone number looks wrong. Check it and try again.';
  if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') return 'Too many tries. Please wait a while and try again.';
  if (code === 'auth/network-request-failed') return 'No internet connection. Turn on mobile data or Wi-Fi and try again.';
  if (code === 'auth/invalid-verification-code') return 'That code is wrong. Check the SMS and type the 6 numbers again.';
  if (code === 'auth/session-expired' || code === 'auth/code-expired') return 'The code expired. Tap "Change number" and get a new code.';
  if (code === 'auth/app-not-authorized' || /not authorized|SHA|play integrity|safetynet/i.test(msg))
    return "This app isn't approved in Firebase yet. The gym admin must add the app's SHA-1 and SHA-256 fingerprints in Firebase (see README).";
  if (code === 'auth/operation-not-allowed') return 'Phone sign-in is turned off. The gym admin must turn on Phone sign-in in Firebase.';
  if (/BILLING_NOT_ENABLED|billing/i.test(msg)) return 'SMS sign-in needs the Firebase Blaze plan. The gym admin must upgrade the Firebase project.';
  return msg;
}
