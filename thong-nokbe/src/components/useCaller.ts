import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useMe } from '../context/AuthProvider';
import { callPerson, startCall } from '../lib/calls';
import type { CallKind, Chat, UserProfile } from '../lib/types';

/** Start a voice or video call and open the call screen. */
export function useCaller() {
  const me = useMe();
  const go = async (fn: () => Promise<string>) => {
    try {
      router.push(`/call/${await fn()}`);
    } catch (e: any) {
      Alert.alert("Can't call", e?.message ?? String(e));
    }
  };
  return {
    callChat: (chat: Chat, title: string, kind: CallKind) => go(() => startCall(chat, me, title, kind)),
    callUser: (user: UserProfile, kind: CallKind) => go(() => callPerson(me, user, kind)),
  };
}
