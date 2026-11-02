import { Linking, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { startActivityAsync } from 'expo-intent-launcher';
import { APP_INVITE_LINK, UPDATE_INFO_URL } from '../config';

/** This APK's build number (set by the GitHub build). 0 = a developer build: never asks to update. */
export const BUILD_NUMBER = Number(process.env.EXPO_PUBLIC_BUILD_NUMBER ?? 0) || 0;

export type UpdateInfo = { build: number; notes: string; url: string };

/** The newest announced version (written by the GitHub build when an update is sent to everyone). */
export async function fetchLatestUpdate(): Promise<UpdateInfo | null> {
  try {
    const r = await fetch(`${UPDATE_INFO_URL}?t=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
    if (!r.ok) return null;
    const j = await r.json();
    const build = Number(j?.build);
    if (!build) return null;
    return { build, notes: String(j.notes ?? ''), url: String(j.url || APP_INVITE_LINK) };
  } catch {
    return null;
  }
}

/** A newer version than this phone has, or null. */
export async function findUpdate(): Promise<UpdateInfo | null> {
  if (!BUILD_NUMBER) return null;
  const u = await fetchLatestUpdate();
  return u && u.build > BUILD_NUMBER ? u : null;
}

/** Fallback only: opens the APK download in the phone's browser. */
export function downloadUpdate(url?: string) {
  return Linking.openURL(url || APP_INVITE_LINK);
}

const apkPath = (build: number) => `${FileSystem.cacheDirectory}ThongNokbeGym-${build}.apk`;
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * Downloads the new version inside the app (with progress), then opens Android's installer on it.
 * Android always asks the person to tap "Update" once (apps outside the Play Store can't update
 * silently), and the very first time it asks to "Allow from this source".
 */
export async function downloadAndInstall(update: UpdateInfo, onProgress: (fraction: number) => void): Promise<void> {
  if (Platform.OS !== 'android') {
    await downloadUpdate(update.url);
    return;
  }
  const path = apkPath(update.build);
  const existing = await FileSystem.getInfoAsync(path).catch(() => null);
  if (!existing?.exists) {
    // Download to a temporary name first, so a half-finished download is never installed.
    const part = `${path}.part`;
    await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
    const task = FileSystem.createDownloadResumable(update.url, part, {}, (p) => {
      if (p.totalBytesExpectedToWrite > 0) onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
    });
    const res = await task.downloadAsync().catch(() => null);
    if (!res || res.status !== 200) {
      await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
      throw new Error(`Download failed${res ? ` (${res.status})` : ''}. Check your internet and try again.`);
    }
    await FileSystem.moveAsync({ from: part, to: path });
  }
  onProgress(1);
  const contentUri = await FileSystem.getContentUriAsync(path);
  await startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

/** Removes downloaded update files this phone no longer needs (the app is already that version or newer). */
export async function cleanOldDownloads() {
  if (Platform.OS !== 'android' || !FileSystem.cacheDirectory) return;
  try {
    for (const name of await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory)) {
      const m = /^ThongNokbeGym-(\d+)\.apk(\.part)?$/.exec(name);
      if (m && Number(m[1]) <= BUILD_NUMBER) await FileSystem.deleteAsync(FileSystem.cacheDirectory + name, { idempotent: true });
    }
  } catch {}
}

/** Lets other screens (Me → Check for updates) open the in-app update box. */
const checkRequests = new Set<() => void>();
export const onUpdateCheckRequest = (fn: () => void) => {
  checkRequests.add(fn);
  return () => {
    checkRequests.delete(fn);
  };
};
export const requestUpdateCheck = () => checkRequests.forEach((fn) => fn());
