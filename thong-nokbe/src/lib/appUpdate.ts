import { Linking } from 'react-native';
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

/** Opens the APK download in the phone's browser; the phone then offers to install it over the old one. */
export function downloadUpdate(url?: string) {
  return Linking.openURL(url || APP_INVITE_LINK);
}
