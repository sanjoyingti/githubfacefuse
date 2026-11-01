import { useEffect, useState } from 'react';
import { collection, doc, documentId, getDocs, onSnapshot, query, where } from '@react-native-firebase/firestore';
import { db } from './firebase';
import type { UserProfile } from './types';

const cache = new Map<string, UserProfile>();
const listeners = new Set<() => void>();
const inflight = new Set<string>();

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchUsers(uids: string[]) {
  const missing = uids.filter((u) => !cache.has(u) && !inflight.has(u));
  if (!missing.length) return;
  missing.forEach((u) => inflight.add(u));
  try {
    for (const part of chunk(missing, 30)) {
      const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', part)));
      snap.forEach((d) => cache.set(d.id, { uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }));
    }
  } finally {
    missing.forEach((u) => inflight.delete(u));
    listeners.forEach((l) => l());
  }
}

/** Returns a uid -> profile map for the given uids, loading any that aren't cached. */
export function useUsers(uids: string[]): Record<string, UserProfile> {
  const [, force] = useState(0);
  const key = [...uids].sort().join(',');
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    fetchUsers(uids).catch(() => {});
    return () => {
      listeners.delete(l);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const out: Record<string, UserProfile> = {};
  for (const u of uids) {
    const p = cache.get(u);
    if (p) out[u] = p;
  }
  return out;
}

export function useUser(uid: string | null | undefined): UserProfile | null {
  const [p, setP] = useState<UserProfile | null>(uid ? cache.get(uid) ?? null : null);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'users', uid), (s) => {
      if (!s.exists()) return;
      const v = { uid, ...(s.data() as Omit<UserProfile, 'uid'>) };
      cache.set(uid, v);
      setP(v);
    });
  }, [uid]);
  return p;
}

export function displayName(p: UserProfile | undefined | null, fallback = 'Member') {
  return p?.name || p?.phone || fallback;
}

/** Looks up which of these E.164 numbers belong to registered app users. */
export async function findUsersByPhones(phones: string[]): Promise<Record<string, UserProfile>> {
  const unique = [...new Set(phones)];
  const byPhone: Record<string, UserProfile> = {};
  for (const part of chunk(unique, 30)) {
    const snap = await getDocs(query(collection(db, 'users'), where('phone', 'in', part)));
    snap.forEach((d) => {
      const p = { uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) };
      cache.set(d.id, p);
      byPhone[p.phone] = p;
    });
  }
  return byPhone;
}
