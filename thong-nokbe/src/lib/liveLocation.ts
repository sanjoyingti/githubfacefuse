import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from '@react-native-firebase/firestore';
import { auth, db } from './firebase';
import type { LiveLocation } from './types';

/**
 * Live location for gym groups — ONE switch, "Share my live location".
 * Asked once when the app is first set up; the person can turn it ON or OFF any time (Me screen or the
 * group map). While ON, their point is kept in chats/{groupId}/locations/{uid} for every group they are
 * in, so the members of those groups (and only them) see them move on the map. Turning it OFF stops
 * the updates and removes their point. Android shows a "sharing location" notice while it runs.
 */
const TASK = 'thong-nokbe-live-location';
const ON_KEY = 'liveShareOn'; // '1' or '0'
const GROUPS_KEY = 'liveShareGroups'; // ids of the groups I'm in (kept up to date by the app)
const NAME_KEY = 'liveLocationName';

const locRef = (chatId: string, uid: string) => doc(db, 'chats', chatId, 'locations', uid);

// ---- small stored state + change listeners -------------------------------------------------------
const listeners = new Set<(on: boolean) => void>();
let onCache: boolean | null = null;

export async function isSharingOn(): Promise<boolean> {
  if (onCache === null) onCache = (await AsyncStorage.getItem(ON_KEY).catch(() => null)) === '1';
  return onCache;
}
async function setOnFlag(on: boolean) {
  onCache = on;
  await AsyncStorage.setItem(ON_KEY, on ? '1' : '0').catch(() => {});
  listeners.forEach((l) => l(on));
}
async function myGroups(): Promise<string[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(GROUPS_KEY)) ?? '[]');
  } catch {
    return [];
  }
}

/** Writes my point to every group I'm in (only while sharing is ON). */
async function pushPoint(lat: number, lng: number, accuracy?: number, only?: string[]) {
  const uid = auth.currentUser?.uid;
  if (!uid || !(await isSharingOn())) return;
  const name = (await AsyncStorage.getItem(NAME_KEY)) || 'Member';
  const groups = only ?? (await myGroups());
  await Promise.all(
    groups.map((chatId) =>
      setDoc(locRef(chatId, uid), { lat, lng, accuracy: accuracy ?? 0, name, sharing: true, updatedAt: serverTimestamp() }).catch(() => {}),
    ),
  );
}

// Background (foreground-service) task: Android delivers locations here even when the app is not on screen.
TaskManager.defineTask(TASK, async ({ data, error }: any) => {
  if (error || !data?.locations?.length) return;
  const last = data.locations[data.locations.length - 1];
  await pushPoint(last.coords.latitude, last.coords.longitude, last.coords.accuracy);
});

async function startBackgroundUpdates() {
  const bg = await Location.getBackgroundPermissionsAsync().catch(() => ({ granted: false }));
  if (!bg.granted) return; // "while using the app" only: the app-open updater covers it
  if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) return;
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 30_000,
    distanceInterval: 25,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Thong Nokbe Gym — sharing your live location',
      notificationBody: 'Your gym groups can see where you are. Turn it off in the app any time.',
      notificationColor: '#16A34A',
    },
  }).catch(() => {});
}
async function stopBackgroundUpdates() {
  if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(TASK).catch(() => {});
}

export type ShareResult = 'on' | 'on-while-open' | 'denied' | 'off';

/** Ask the phone for location permission ("while using" first, then "all the time" for background). */
export async function askLocationPermission(background = true): Promise<'all' | 'while-open' | 'denied'> {
  const fg = await Location.requestForegroundPermissionsAsync().catch(() => ({ granted: false }));
  if (!fg.granted) return 'denied';
  if (!background) return 'while-open';
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
  return bg.granted ? 'all' : 'while-open';
}

/** Turn "Share my live location" ON or OFF for all my groups. */
export async function setSharing(on: boolean, myName?: string): Promise<ShareResult> {
  if (!on) {
    await setOnFlag(false);
    await stopBackgroundUpdates();
    const uid = auth.currentUser?.uid;
    if (uid) await Promise.all((await myGroups()).map((g) => deleteDoc(locRef(g, uid)).catch(() => {})));
    return 'off';
  }
  const perm = await askLocationPermission(true);
  if (perm === 'denied') return 'denied';
  if (myName) await AsyncStorage.setItem(NAME_KEY, myName).catch(() => {});
  await setOnFlag(true);
  try {
    const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    await pushPoint(here.coords.latitude, here.coords.longitude, here.coords.accuracy ?? undefined);
  } catch {}
  await startBackgroundUpdates();
  return perm === 'all' ? 'on' : 'on-while-open';
}

/** Live value of the switch. */
export function useSharingOn(): boolean {
  const [on, setOn] = useState(!!onCache);
  useEffect(() => {
    let alive = true;
    isSharingOn().then((v) => alive && setOn(v));
    listeners.add(setOn);
    return () => {
      alive = false;
      listeners.delete(setOn);
    };
  }, []);
  return on;
}

/**
 * Runs at the app root: keeps the list of my groups (so a group I join starts seeing me), and while
 * sharing is ON keeps my point fresh while the app is open — whatever screen I'm on.
 */
export function useLiveLocationService(groupIds: string[], myName: string | undefined) {
  const on = useSharingOn();
  const key = [...groupIds].sort().join(',');

  // Remember my groups + name; when a new group appears, show me there right away.
  useEffect(() => {
    (async () => {
      const before = await myGroups();
      const ids = key ? key.split(',') : [];
      await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(ids)).catch(() => {});
      if (myName) await AsyncStorage.setItem(NAME_KEY, myName).catch(() => {});
      const added = ids.filter((g) => !before.includes(g));
      if (on && added.length) {
        const last = await Location.getLastKnownPositionAsync().catch(() => null);
        if (last) await pushPoint(last.coords.latitude, last.coords.longitude, last.coords.accuracy ?? undefined, added);
      }
    })();
  }, [key, myName, on]);

  // While ON: make sure the background service runs (if allowed) and update while the app is open.
  useEffect(() => {
    if (!on) return;
    startBackgroundUpdates();
    let sub: Location.LocationSubscription | null = null;
    let stopped = false;
    Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 20 }, (p) =>
      pushPoint(p.coords.latitude, p.coords.longitude, p.coords.accuracy ?? undefined),
    )
      .then((s) => (stopped ? s.remove() : (sub = s)))
      .catch(() => {});
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') startBackgroundUpdates();
    });
    return () => {
      stopped = true;
      sub?.remove();
      app.remove();
    };
  }, [on]);
}

/** Everyone's live point in a group, updating in real time. */
export function useGroupLocations(chatId: string | undefined): LiveLocation[] {
  const [points, setPoints] = useState<LiveLocation[]>([]);
  useEffect(() => {
    if (!chatId) return;
    return onSnapshot(
      collection(db, 'chats', chatId, 'locations'),
      (snap) => setPoints(snap.docs.map((d) => ({ ...(d.data() as LiveLocation), uid: d.id }))),
      () => {},
    );
  }, [chatId]);
  return points;
}
