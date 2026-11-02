import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { getInitialNotification, getMessaging, onNotificationOpenedApp, subscribeToTopic } from '@react-native-firebase/messaging';
import { downloadUpdate, findUpdate, type UpdateInfo } from '../lib/appUpdate';
import { APP_NAME, colors } from '../theme';

const CHECK_EVERY_MS = 15 * 60 * 1000;

/**
 * 🎉 "New version available" — shown when the app opens (or comes back to the screen) and a newer
 * version has been sent to everyone. The push notification for closed apps comes from the
 * 'app-updates' topic, which every phone joins here.
 */
export function UpdateChecker() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const lastCheck = useRef(0);
  const dismissed = useRef(0);

  const check = useCallback(async () => {
    if (Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
    lastCheck.current = Date.now();
    const u = await findUpdate();
    if (u && u.build !== dismissed.current) setUpdate(u);
  }, []);

  useEffect(() => {
    const messaging = getMessaging();
    subscribeToTopic(messaging, 'app-updates').catch(() => {});
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    // Tapping the "update available" push notification: check right away and show the update box.
    const onTap = (data?: Record<string, unknown>) => {
      if (data?.kind !== 'update') return;
      lastCheck.current = 0;
      dismissed.current = 0;
      check();
    };
    getInitialNotification(messaging).then((m) => onTap(m?.data));
    const unsub = onNotificationOpenedApp(messaging, (m) => onTap(m?.data));
    return () => {
      sub.remove();
      unsub();
    };
  }, [check]);

  if (!update) return null;
  const close = () => {
    dismissed.current = update.build;
    setUpdate(null);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.title}>New version of {APP_NAME}!</Text>
          {!!update.notes && <Text style={styles.notes}>{update.notes}</Text>}
          <Text style={styles.steps}>Tap "Update now" → the download starts → open it → tap "Update". Your groups, chats and fees stay.</Text>
          <Pressable
            style={styles.primary}
            onPress={() => {
              downloadUpdate(update.url).catch(() => {});
              close();
            }}
          >
            <Text style={styles.primaryText}>⬇️ Update now</Text>
          </Pressable>
          <Pressable style={styles.later} onPress={close}>
            <Text style={styles.laterText}>Later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
  box: { backgroundColor: colors.card, borderRadius: 24, padding: 22, alignItems: 'center' },
  emoji: { fontSize: 48 },
  title: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center', marginTop: 6 },
  notes: { color: colors.text, fontSize: 16, marginTop: 12, textAlign: 'center', lineHeight: 22 },
  steps: { color: colors.muted, fontSize: 14, marginTop: 12, textAlign: 'center', lineHeight: 20 },
  primary: { marginTop: 18, alignSelf: 'stretch', height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  later: { marginTop: 8, height: 44, justifyContent: 'center' },
  laterText: { color: colors.muted, fontSize: 16, fontWeight: '700' },
});
