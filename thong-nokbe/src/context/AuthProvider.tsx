import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from '@react-native-firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc } from '@react-native-firebase/firestore';
import { auth, db } from '../lib/firebase';
import { joinPendingGroups } from '../lib/chats';
import { registerForPush, unregisterPush } from '../lib/push';
import type { UserProfile } from '../lib/types';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  initializing: boolean;
  saveProfile: (name: string, about?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthReady(true);
        if (!u) {
          setProfile(null);
          setProfileReady(true);
        } else {
          setProfileReady(false);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, 'users', user.uid),
      (s) => {
        setProfile(s.exists() ? ({ uid: user.uid, ...(s.data() as Omit<UserProfile, 'uid'>) } as UserProfile) : null);
        setProfileReady(true);
      },
      () => setProfileReady(true),
    );
  }, [user]);

  // Once signed in with a profile: register for push and join any groups that invited this number.
  const hasProfile = !!profile;
  useEffect(() => {
    if (!user || !profile) return;
    let unsub: (() => void) | undefined;
    registerForPush(user.uid).then((u) => (unsub = u));
    joinPendingGroups(profile).catch((e) => console.warn('joinPendingGroups', e));
    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, hasProfile]);

  const saveProfile = async (name: string, about?: string) => {
    if (!user?.phoneNumber) throw new Error('Not signed in with a phone number');
    await setDoc(
      doc(db, 'users', user.uid),
      { name: name.trim(), about: about?.trim() ?? '', phone: user.phoneNumber, appInstalled: true, updatedAt: serverTimestamp() },
      { merge: true },
    );
  };

  const logout = async () => {
    if (user) await unregisterPush(user.uid);
    await signOut(auth);
  };

  return (
    <Ctx.Provider value={{ user, profile, initializing: !authReady || !profileReady, saveProfile, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

/** For screens that are only reachable when signed in with a profile. */
export function useMe(): UserProfile {
  const { profile } = useAuth();
  if (!profile) throw new Error('Profile not loaded');
  return profile;
}
