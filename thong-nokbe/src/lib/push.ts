import { arrayRemove, arrayUnion, doc, updateDoc } from '@react-native-firebase/firestore';
import { deleteToken, getMessaging, getToken, onTokenRefresh } from '@react-native-firebase/messaging';
import { getIdToken } from '@react-native-firebase/auth';
import { auth, db } from './firebase';
import { CALL_SERVER_URL } from '../config';

/**
 * Push notifications through Firebase Cloud Messaging (free). This phone's push token is saved on the
 * user's profile; the call-pass server uses it to ring this phone for calls and to notify about
 * messages, even when the app is closed.
 */
const messaging = getMessaging();
let pushReady = false;
export const isPushReady = () => pushReady;

export async function registerPush(uid: string): Promise<() => void> {
  try {
    const save = (token: string) =>
      updateDoc(doc(db, 'users', uid), { pushTokens: arrayUnion(token) })
        .then(() => (pushReady = true))
        .catch(() => {});
    await save(await getToken(messaging));
    return onTokenRefresh(messaging, save);
  } catch (e) {
    console.warn('push registration failed', e);
    return () => {};
  }
}

/** On log out: this phone stops getting calls/notifications for this account. */
export async function unregisterPush(uid: string) {
  try {
    const token = await getToken(messaging);
    await updateDoc(doc(db, 'users', uid), { pushTokens: arrayRemove(token) });
    await deleteToken(messaging);
  } catch {}
  pushReady = false;
}

/** Ask the server to ring people for a call, or notify chat members about my newest message. Fire-and-forget. */
export function notifyServer(body: { kind: 'call'; callId: string } | { kind: 'message'; chatId: string }) {
  const user = auth.currentUser;
  if (!user || !CALL_SERVER_URL) return;
  getIdToken(user)
    .then((idToken) =>
      fetch(`${CALL_SERVER_URL}/notify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify(body),
      }),
    )
    .catch(() => {});
}
