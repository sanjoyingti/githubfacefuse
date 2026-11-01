import Constants from 'expo-constants';
import { GoogleSignin, isCancelledResponse, statusCodes } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential } from '@react-native-firebase/auth';
import { auth } from './firebase';

let configured = false;
function configure() {
  if (configured) return;
  const webClientId = (Constants.expoConfig?.extra as { googleWebClientId?: string } | undefined)?.googleWebClientId || undefined;
  GoogleSignin.configure({ webClientId });
  configured = true;
}

/** Opens the Google account picker and signs into Firebase. Returns false if the person cancelled. Free, no SMS. */
export async function signInWithGoogle(): Promise<boolean> {
  configure();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (isCancelledResponse(res)) return false;
  const idToken = res.data.idToken;
  if (!idToken) throw new Error('Google did not return a sign-in token. Turn on Google sign-in in Firebase and add the SHA-1 fingerprint (see SETUP-GUIDE).');
  await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  return true;
}

export async function signOutGoogle() {
  configure();
  await GoogleSignin.signOut().catch(() => {});
}

export function friendlyGoogleError(e: any): string | null {
  if (e?.code === statusCodes.SIGN_IN_CANCELLED) return null;
  if (e?.code === statusCodes.IN_PROGRESS) return null;
  if (e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return 'Google Play services is missing or out of date on this phone. Update it from the Play Store.';
  if (String(e?.code) === '10' || /DEVELOPER_ERROR/i.test(String(e?.message)))
    return "Google sign-in isn't set up for this app yet. The gym admin must enable Google sign-in in Firebase and add the app's SHA-1 fingerprint (see SETUP-GUIDE).";
  return null;
}
