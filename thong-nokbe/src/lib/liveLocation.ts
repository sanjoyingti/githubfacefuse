import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { collection, deleteDoc, doc, onSnapshot, setDoc, serverTimestamp } from '@react-native-firebase/firestore';
import { auth, db } from './firebase';
import type { LiveLocation } from './types';

/**
 * Live location for gym groups. A member turns it ON for a group (once, after giving the phone
 * permission). Their phone then keeps their point in chats/{id}/locations/{uid} — updated while the
 * app is open and, through a foreground service, while it is in the background too — so every member
 * of that group sees them move on the map. They can turn it OFF any time; Android also always shows a
 * "using your location" notice while it is on.
 */
const TASK = 'thong-nokbe-live-location';
const GROUPS_KEY = 'liveLocationGroups'; // the groups this phone is sharing with
const NAME_KEY = 'liveLocationName';

const locRef = (chatId: string, uid: string) => doc(db, 'chats', chatId, 'locations', uid);

async function sharingGroups(): Promise<string[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(GROUPS_KEY)) ?? '[]');
  } catch {
    return [];
  }
}
async function setSharingGroups(ids: string[]) {
  await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify([...new Set(ids)])).catch(() => {});
}

/** Writes my current point to every group I share with. Called by the background task and the app. */
async function pushPoint(lat: number, lng: number, accuracy?: number) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const name = (await AsyncStorage.getItem(NAME_KEY)) || 'Member';
  const groups = await sharingGroups();
  await Promise.all(
    groups.map((chatId) =>
      setDoc(locRef(chatId, uid), { uid, lat, lng, accuracy: accuracy ?? 0, name, sharing: true, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {}),
    ),
  );
}

// Background/foreground-service task: Android delivers locations here even when the app is not on screen.
TaskManager.defineTask(TASK, async ({ data, error }: any) => {
  if (error || !data?.locations?.length) return;
  const last = data.locations[data.locations.length - 1];
  await pushPoint(last.coords.latitude, last.coords.longitude, last.coords.accuracy);
});

export type PermissionResult = 'ok' | 'denied' | 'denied-background';

/** Ask for location permission (foreground, then "all the time" for background updates). */
export async function askLocationPermission(): Promise<PermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
  return bg.granted ? 'ok' : 'denied-background';
}

async function ensureUpdatesRunning() {
  const started = await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false);
  if (started) return;
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 30_000, // every ~30s
    distanceInterval: 25, // or every 25 m
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Thong Nokbe Gym — sharing your location',
      notificationBody: 'Your gym group can see where you are. Tap to stop.',
      notificationColor: '#16A34A',
    },
  });
}

async function stopUpdatesIfIdle() {
  if ((await sharingGroups()).length > 0) return;
  const started = await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false);
  if (started) await Location.stopLocationUpdatesAsync(TASK).catch(() => {});
}

/** Turn live location ON for a group. Returns false if permission was refused. */
export async function startSharing(chatId: string, myName: string): Promise<PermissionResult> {
  const perm = await askLocationPermission();
  if (perm === 'denied') return perm;
  await AsyncStorage.setItem(NAME_KEY, myName).catch(() => {});
  await setSharingGroups([...(await sharingGroups()), chatId]);
  try {
    const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    await pushPoint(here.coords.latitude, here.coords.longitude, here.coords.accuracy ?? undefined);
  } catch {}
  if (perm === 'ok') await ensureUpdatesRunning().catch(() => {});
  // 'denied-background': still works while the app is open (handled by the in-app updater below).
  return perm;
}

/** Turn live location OFF for a group: stop updating and remove my point so nobody sees me. */
export async function stopSharing(chatId: string) {
  const uid = auth.currentUser?.uid;
  await setSharingGroups((await sharingGroups()).filter((g) => g !== chatId));
  if (uid) await deleteDoc(locRef(chatId, uid)).catch(() => {});
  await stopUpdatesIfIdle();
}

/** Am I currently sharing with this group? */
export function useIsSharing(chatId: string | undefined): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!chatId) return;
    let alive = true;
    const check = () => sharingGroups().then((g) => alive && setOn(g.includes(chatId)));
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    const t = setInterval(check, 2000);
    return () => {
      alive = false;
      sub.remove();
      clearInterval(t);
    };
  }, [chatId]);
  return on;
}

/**
 * While the app is open, also push my point from here (covers phones that only gave "while using the
 * app" permission, and updates faster than the background service).
 */
export function useForegroundUpdater(chatId: string | undefined) {
  const sharing = useIsSharing(chatId);
  useEffect(() => {
    if (!chatId || !sharing) return;
    let sub: Location.LocationSubscription | null = null;
    Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 20 }, (p) =>
      pushPoint(p.coords.latitude, p.coords.longitude, p.coords.accuracy ?? undefined),
    )
      .then((s) => (sub = s))
      .catch(() => {});
    return () => sub?.remove();
  }, [chatId, sharing]);
}

/** Everyone's live point in a group, updating in real time. */
export function useGroupLocations(chatId: string | undefined): LiveLocation[] {
  const [points, setPoints] = useState<LiveLocation[]>([]);
  useEffect(() => {
    if (!chatId) return;
    return onSnapshot(
      collection(db, 'chats', chatId, 'locations'),
      (snap) => setPoints(snap.docs.map((d) => d.data() as LiveLocation)),
      () => {},
    );
  }, [chatId]);
  return points;
}
