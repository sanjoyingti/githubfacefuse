import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { getInitialNotification, getMessaging, onNotificationOpenedApp, subscribeToTopic } from '@react-native-firebase/messaging';
import { cleanOldDownloads, downloadAndInstall, findUpdate, onUpdateCheckRequest, type UpdateInfo } from '../lib/appUpdate';
import { APP_NAME, colors } from '../theme';

const CHECK_EVERY_MS = 15 * 60 * 1000;

/**
 * 🎉 "New version available" — shown when the app opens (or comes back to the screen) and a newer
 * version has been sent to everyone. The push notification for closed apps comes from the
 * 'app-updates' topic, which every phone joins here.
 */
export function UpdateChecker() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  // null = not started; 0..1 = downloading; 'install' = Android's installer is open
  const [progress, setProgress] = useState<number | 'install' | null>(null);
  const [error, setError] = useState('');
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
    cleanOldDownloads();
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
    const unsubManual = onUpdateCheckRequest(() => onTap({ kind: 'update' }));
    return () => {
      sub.remove();
      unsub();
      unsubManual();
    };
  }, [check]);

  if (!update) return null;
  const busy = progress !== null;
  const close = () => {
    if (busy && progress !== 'install') return; // finish the download first
    dismissed.current = update.build;
    setUpdate(null);
    setProgress(null);
    setError('');
  };
  const start = async () => {
    setError('');
    setProgress(0);
    try {
      await downloadAndInstall(update, (f) => setProgress(f));
      setProgress('install');
    } catch (e: any) {
      setProgress(null);
      setError(e?.message ?? String(e));
    }
  };
  const pct = typeof progress === 'number' ? Math.round(progress * 100) : 0;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.title}>New version of {APP_NAME}!</Text>
          {!!update.notes && <Text style={styles.notes}>{update.notes}</Text>}

          {typeof progress === 'number' ? (
            <View style={{ alignSelf: 'stretch', marginTop: 18 }}>
              <Text style={styles.steps}>Downloading the update… {pct}%</Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.max(3, pct)}%` }]} />
              </View>
              <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
              <Text style={styles.small}>Please keep the app open.</Text>
            </View>
          ) : progress === 'install' ? (
            <>
              <Text style={styles.steps}>
                Tap <Text style={{ fontWeight: '900', color: colors.text }}>Update</Text> on the next screen.{'\n'}
                First time only: if Android says &quot;not allowed&quot;, tap Settings → turn on &quot;Allow from this source&quot; → go back → Update.
              </Text>
              <Pressable style={styles.primary} onPress={start}>
                <Text style={styles.primaryText}>📲 Install again</Text>
              </Pressable>
              <Pressable style={styles.later} onPress={close}>
                <Text style={styles.laterText}>Close</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.steps}>Tap &quot;Update now&quot;. It downloads inside the app, then tap &quot;Update&quot;. Your groups, chats and fees stay.</Text>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable style={styles.primary} onPress={start}>
                <Text style={styles.primaryText}>{error ? '🔄 Try again' : '⬇️ Update now'}</Text>
              </Pressable>
              <Pressable style={styles.later} onPress={close}>
                <Text style={styles.laterText}>Later</Text>
              </Pressable>
            </>
          )}
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
  track: { height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden', marginTop: 10 },
  fill: { height: 10, backgroundColor: colors.primary },
  small: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 8 },
  error: { color: colors.unpaid, fontSize: 14, marginTop: 10, textAlign: 'center' },
  laterText: { color: colors.muted, fontSize: 16, fontWeight: '700' },
});
