import { useEffect } from 'react';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { acceptCall, getCall, RING_TIMEOUT_MS } from '../lib/calls';
import type { UserProfile } from '../lib/types';

/** Opens the right screen when the user taps one of the app's notifications. */
export function NotificationRouter({ me }: { me: UserProfile }) {
  useEffect(() => {
    const open = async (data: Record<string, string>) => {
      if (data.kind === 'call' && data.callId) {
        const call = await getCall(data.callId);
        const fresh = call?.createdAt && Date.now() - call.createdAt.toMillis() < RING_TIMEOUT_MS;
        if (call && call.status !== 'ended' && fresh) {
          await acceptCall(call.id, me).catch(() => {});
          router.push(`/call/${call.id}`);
          return;
        }
      }
      if (data.kind === 'fees') return router.push('/(tabs)/fees');
      if (data.chatId) router.push(`/chat/${data.chatId}`);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open((last.notification.request.content.data ?? {}) as Record<string, string>);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open((r.notification.request.content.data ?? {}) as Record<string, string>));
    return () => sub.remove();
  }, [me]);
  return null;
}
