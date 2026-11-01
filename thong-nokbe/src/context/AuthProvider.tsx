import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from '@react-native-firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc, writeBatch } from '@react-native-firebase/firestore';
import { auth, db } from '../lib/firebase';
import { requestInvitedGroups } from '../lib/chats';
import { signOutGoogle } from '../lib/googleAuth';
import { setupNotifications } from '../lib/localNotify';
import { registerPush, unregisterPush } from '../lib/push';
import type { UserProfile } from '../lib/types';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  initializing: boolean;
  /** First-time registration: claims the phone number (one account per number) and creates the profile. */
  register: (name: string, phone: string) => Promise<void>;
  updateProfileInfo: (name: string, about: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export class PhoneTakenError extends Error {}

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

  // Once registered: mark "has the app", allow notifications, and ask to join groups that invited this number.
  const hasProfile = !!profile;
  useEffect(() => {
    if (!user || !profile) return;
    if (profile.appInstalled === false) updateDoc(doc(db, 'users', user.uid), { appInstalled: true }).catch(() => {});
    let unsub: (() => void) | undefined;
    setupNotifications().then(() => registerPush(user.uid).then((u) => (unsub = u)));
    requestInvitedGroups(profile).catch((e) => console.warn('requestInvitedGroups', e));
    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, hasProfile]);

  const register = async (name: string, phone: string) => {
    if (!user) throw new Error('Not signed in');
    const phoneRef = doc(db, 'phoneIndex', phone);
    const existing = await getDoc(phoneRef);
    if (existing.exists() && existing.data()?.uid !== user.uid) throw new PhoneTakenError('This phone number is already registered by another account.');
    const batch = writeBatch(db);
    if (!existing.exists()) batch.set(phoneRef, { uid: user.uid, createdAt: serverTimestamp() });
    batch.set(doc(db, 'users', user.uid), {
      name: name.trim(),
      about: '',
      phone,
      email: user.email ?? null,
      appInstalled: true,
      activatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  };

  const updateProfileInfo = async (name: string, about: string) => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { name: name.trim(), about: about.trim(), updatedAt: serverTimestamp() });
  };

  const logout = async () => {
    // This person can't be called until they sign in again.
    if (user && profile) {
      await unregisterPush(user.uid);
      await updateDoc(doc(db, 'users', user.uid), { appInstalled: false }).catch(() => {});
    }
    await signOutGoogle();
    await signOut(auth);
  };

  return (
    <Ctx.Provider value={{ user, profile, initializing: !authReady || !profileReady, register, updateProfileInfo, logout }}>{children}</Ctx.Provider>
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
