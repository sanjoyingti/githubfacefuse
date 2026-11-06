import { PermissionsAndroid, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { startActivityAsync } from 'expo-intent-launcher';
import { getPermissionsAsync as getContactsPermission, requestPermissionsAsync as requestContactsPermission } from 'expo-contacts';

/** Set once the person has been through the first-launch permissions screen on this phone. */
export const PERMS_DONE_KEY = 'permissionsOnboarded';

export type PermKey = 'notifications' | 'contacts' | 'location' | 'calls';
export type PermState = Record<PermKey, boolean>;

const CALL_PERMS = [
  PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  PermissionsAndroid.PERMISSIONS.CAMERA,
  ...(Platform.OS === 'android' && Number(Platform.Version) >= 31 ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] : []),
].filter(Boolean);

/** What the phone currently allows. */
export async function readPermissions(): Promise<PermState> {
  const [n, c, l] = await Promise.all([
    Notifications.getPermissionsAsync().catch(() => ({ granted: false })),
    getContactsPermission().catch(() => ({ granted: false })),
    Location.getForegroundPermissionsAsync().catch(() => ({ granted: false })),
  ]);
  let calls = true;
  if (Platform.OS === 'android') {
    for (const p of CALL_PERMS) if (!(await PermissionsAndroid.check(p).catch(() => false))) calls = false;
  }
  return { notifications: !!n.granted, contacts: !!c.granted, location: !!l.granted, calls };
}

/** Ask for one permission (the phone shows its own "Allow" box). */
export async function requestPermission(key: PermKey): Promise<boolean> {
  try {
    if (key === 'notifications') return (await Notifications.requestPermissionsAsync()).granted;
    if (key === 'contacts') return (await requestContactsPermission()).granted;
    if (key === 'location') return (await Location.requestForegroundPermissionsAsync()).granted;
    if (Platform.OS !== 'android') return true;
    const res = await PermissionsAndroid.requestMultiple(CALL_PERMS);
    return Object.values(res).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

/**
 * Android battery saving (Samsung, Xiaomi, Vivo, Oppo…) stops apps in the background, which stops
 * live location while the app is closed. This opens Android's "allow running in background" box.
 */
export async function askIgnoreBatteryOptimization() {
  if (Platform.OS !== 'android') return;
  try {
    await startActivityAsync('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', { data: 'package:com.thongnokbe.app' });
  } catch {
    await startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => {});
  }
}
