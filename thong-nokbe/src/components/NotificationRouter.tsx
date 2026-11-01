import { useEffect } from 'react';
import { router } from 'expo-router';
import { getInitialNotification, onNotificationOpenedApp, type RemoteMessage } from '@react-native-firebase/messaging';
import { messaging } from '../lib/firebase';
import { acceptCall, getCall, RING_TIMEOUT_MS } from '../lib/calls';
import type { UserProfile } from '../lib/types';

/** Opens the right screen when the user taps a push notification (chat, call or fees). */
export function NotificationRouter({ me }: { me: UserProfile }) {
  useEffect(() => {
    const open = async (m: RemoteMessage | null) => {
      const data = (m?.data ?? {}) as Record<string, string>;
      if (data.kind === 'call' && data.callId) {
        const call = await getCall(data.callId);
        const fresh = call?.createdAt && Date.now() - call.createdAt.toMillis() < RING_TIMEOUT_MS;
        if (call && call.status !== 'ended' && fresh) {
          await acceptCall(call.id, me).catch(() => {});
          router.push(`/call/${call.id}`);
          return;
        }
        if (data.chatId) router.push(`/chat/${data.chatId}`);
      } else if (data.kind === 'fees') {
        router.push('/(tabs)/fees');
      } else if (data.chatId) {
        router.push(`/chat/${data.chatId}`);
      }
    };
    getInitialNotification(messaging).then(open);
    return onNotificationOpenedApp(messaging, open);
  }, [me]);
  return null;
}
