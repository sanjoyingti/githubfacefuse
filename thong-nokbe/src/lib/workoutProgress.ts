import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dayKey } from './dates';

/** Exercises ticked "done" today, saved on the phone. A new day starts with an empty list. */
let current: { day: string; ids: Set<string> } = { day: '', ids: new Set() };
const listeners = new Set<() => void>();
const storageKey = (d: string) => `workout-done:${d}`;

async function load() {
  const d = dayKey();
  if (current.day === d) return;
  const raw = await AsyncStorage.getItem(storageKey(d)).catch(() => null);
  current = { day: d, ids: new Set(raw ? (JSON.parse(raw) as string[]) : []) };
  listeners.forEach((l) => l());
}

export async function toggleDone(id: string) {
  await load();
  const ids = new Set(current.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  current = { day: current.day, ids };
  listeners.forEach((l) => l());
  await AsyncStorage.setItem(storageKey(current.day), JSON.stringify([...ids])).catch(() => {});
}

export function useDoneToday(): Set<string> {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    load();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return current.day === dayKey() ? current.ids : new Set();
}
