import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

/** Video quality choice for exercise videos. 360p is the normal (default) setting. */
export type VideoQuality = 144 | 240 | 360 | 480 | 720 | 0; // 0 = Auto (best for the screen)
export const QUALITY_OPTIONS: { value: VideoQuality; label: string; hint: string }[] = [
  { value: 144, label: '144p', hint: 'Very weak internet' },
  { value: 240, label: '240p', hint: 'Weak internet' },
  { value: 360, label: '360p', hint: 'Normal' },
  { value: 480, label: '480p', hint: 'Good internet' },
  { value: 720, label: '720p HD', hint: 'Wi-Fi' },
  { value: 0, label: 'Auto', hint: 'Best for your screen' },
];
export const DEFAULT_QUALITY: VideoQuality = 360;
const KEY = 'videoQuality';

let current: VideoQuality = DEFAULT_QUALITY;
let loaded = false;
const listeners = new Set<(q: VideoQuality) => void>();

async function load() {
  if (loaded) return;
  loaded = true;
  const v = Number(await AsyncStorage.getItem(KEY).catch(() => null));
  if (QUALITY_OPTIONS.some((o) => o.value === v) && v !== current) {
    current = v as VideoQuality;
    listeners.forEach((l) => l(current));
  }
}

export async function setVideoQuality(q: VideoQuality) {
  current = q;
  listeners.forEach((l) => l(q));
  await AsyncStorage.setItem(KEY, String(q)).catch(() => {});
}

export function useVideoQuality(): VideoQuality {
  const [q, setQ] = useState<VideoQuality>(current);
  useEffect(() => {
    listeners.add(setQ);
    load();
    return () => {
      listeners.delete(setQ);
    };
  }, []);
  return q;
}
