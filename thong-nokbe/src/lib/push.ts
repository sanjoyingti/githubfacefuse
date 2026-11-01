import { Platform, PermissionsAndroid } from 'react-native';
import { arrayUnion, doc, updateDoc } from '@react-native-firebase/firestore';
import { AuthorizationStatus, getToken, onTokenRefresh, requestPermission } from '@react-native-firebase/messaging';
import { db, messaging } from './firebase';

/** Asks for notification permission and stores this device's FCM token on the user's profile. */
export async function registerForPush(uid: string) {
  try {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as any);
    }
    const status = await requestPermission(messaging);
    if (status === AuthorizationStatus.DENIED) return () => {};
    const save = (token: string) => updateDoc(doc(db, 'users', uid), { pushTokens: arrayUnion(token) }).catch(() => {});
    save(await getToken(messaging));
    return onTokenRefresh(messaging, save);
  } catch (e) {
    console.warn('Push registration failed', e);
    return () => {};
  }
}
