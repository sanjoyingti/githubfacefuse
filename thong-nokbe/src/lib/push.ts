import { Platform, PermissionsAndroid } from 'react-native';
import { arrayRemove, arrayUnion, doc, getDoc, updateDoc } from '@react-native-firebase/firestore';
import { deleteToken, getToken, onTokenRefresh, requestPermission } from '@react-native-firebase/messaging';
import { db, messaging } from './firebase';

/**
 * Marks this person as "has the app" and stores this phone's notification token,
 * which is how calls and messages reach them.
 */
export async function registerForPush(uid: string) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { appInstalled: true }).catch(() => {});
  try {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as any);
    }
    await requestPermission(messaging);
    const save = (token: string) => updateDoc(userRef, { pushTokens: arrayUnion(token), appInstalled: true }).catch(() => {});
    save(await getToken(messaging));
    return onTokenRefresh(messaging, save);
  } catch (e) {
    console.warn('Push registration failed', e);
    return () => {};
  }
}

/** On log out: this phone stops receiving calls. If it was the last phone, the person shows as "not on the app". */
export async function unregisterPush(uid: string) {
  try {
    const userRef = doc(db, 'users', uid);
    const token = await getToken(messaging).catch(() => null);
    const snap = await getDoc(userRef);
    const remaining = ((snap.data()?.pushTokens as string[] | undefined) ?? []).filter((t) => t !== token);
    await updateDoc(userRef, { ...(token ? { pushTokens: arrayRemove(token) } : {}), appInstalled: remaining.length > 0 });
    await deleteToken(messaging).catch(() => {});
  } catch (e) {
    console.warn('Push unregister failed', e);
  }
}
