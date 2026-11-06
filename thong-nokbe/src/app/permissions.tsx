import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useMe } from '../context/AuthProvider';
import { PERMS_DONE_KEY, readPermissions, requestPermission, type PermKey, type PermState } from '../lib/permissions';
import { setSharing, useSharingOn } from '../lib/liveLocation';
import { useBottomInset } from '../components/useBottomInset';
import { APP_NAME, colors } from '../theme';

const ITEMS: { key: PermKey; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; why: string }[] = [
  { key: 'notifications', icon: 'notifications', title: 'Notifications', why: 'Calls ring, new messages, fee reminders and app updates.' },
  { key: 'contacts', icon: 'people', title: 'Contacts', why: 'Find gym friends who use the app and add them to groups.' },
  { key: 'location', icon: 'location', title: 'Location', why: 'Share your live location with your gym groups on the map.' },
  { key: 'calls', icon: 'videocam', title: 'Microphone & camera', why: 'Voice and video calls with members.' },
];

/**
 * First-launch setup (and later from Me → Permissions): asks for every permission once, with the
 * live-location switch. Everything can be turned on or off again afterwards.
 */
export default function PermissionsScreen() {
  const me = useMe();
  const bottomInset = useBottomInset();
  const sharing = useSharingOn();
  const [state, setState] = useState<PermState | null>(null);
  const [wantShare, setWantShare] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<boolean | null>(null); // been through setup before on this phone?

  const refresh = useCallback(() => readPermissions().then(setState), []);
  useEffect(() => {
    AsyncStorage.getItem(PERMS_DONE_KEY)
      .then((v) => setDone(v === '1'))
      .catch(() => setDone(false));
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const finish = async () => {
    await AsyncStorage.setItem(PERMS_DONE_KEY, '1').catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const allowAll = async () => {
    setBusy(true);
    try {
      for (const it of ITEMS) await requestPermission(it.key);
      if (!done && wantShare) {
        const r = await setSharing(true, me.name);
        if (r === 'on-while-open')
          Alert.alert('Live location is on', 'Your group sees you while the app is open. To be seen even when the app is closed, set Location to "Allow all the time" for Thong Nokbe Gym in the phone settings.');
      }
      await refresh();
      await finish();
    } finally {
      setBusy(false);
    }
  };

  const toggleShare = async (v: boolean) => {
    if (!done) return setWantShare(v); // first setup: applied by "Allow all & continue"
    {
      // Already set up: the switch acts straight away.
      const r = await setSharing(v, me.name);
      if (r === 'denied') Alert.alert('Location is not allowed', 'Allow location for Thong Nokbe Gym in the phone settings, then turn this on again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
      refresh();
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 18, paddingBottom: 24 + bottomInset }}>
      <Text style={styles.title}>Welcome to {APP_NAME} 💪</Text>
      <Text style={styles.sub}>Allow these once so everything works. You can turn any of them off again later.</Text>

      {ITEMS.map((it) => {
        const ok = state?.[it.key];
        return (
          <View key={it.key} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.icon}>
                <Ionicons name={it.icon} size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{it.title}</Text>
                <Text style={styles.why}>{it.why}</Text>
              </View>
              {state === null ? (
                <ActivityIndicator color={colors.primary} />
              ) : ok ? (
                <Text style={styles.ok}>Allowed ✅</Text>
              ) : (
                <Pressable style={styles.allow} onPress={() => requestPermission(it.key).then(refresh)}>
                  <Text style={styles.allowText}>Allow</Text>
                </Pressable>
              )}
            </View>
            {it.key === 'location' && (
              <View style={[styles.row, { marginTop: 12 }]}>
                <Text style={[styles.why, { flex: 1, color: colors.text, fontWeight: '700', fontSize: 15 }]}>📍 Share my live location with my gym groups</Text>
                <Switch value={done ? sharing : wantShare} onValueChange={toggleShare} trackColor={{ true: colors.primary }} />
              </View>
            )}
          </View>
        );
      })}

      <Pressable style={[styles.primary, busy && { opacity: 0.6 }]} onPress={allowAll} disabled={busy}>
        <Text style={styles.primaryText}>{busy ? 'Asking…' : done ? '✅ Allow all' : '✅ Allow all & continue'}</Text>
      </Pressable>
      <Pressable style={styles.later} onPress={finish}>
        <Text style={styles.laterText}>{done ? 'Done' : 'Not now'}</Text>
      </Pressable>
      <Text style={styles.note}>Change any time: Me → Permissions & live location. Android asks with its own box for each one.</Text>
      <Pressable onPress={() => Linking.openSettings()} style={{ alignSelf: 'center', marginTop: 8 }}>
        <Text style={{ color: colors.primary, fontWeight: '700' }}>Open phone settings</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 24, fontWeight: '900' },
  sub: { color: colors.muted, fontSize: 15, marginTop: 6, marginBottom: 16, lineHeight: 21 },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  why: { color: colors.muted, fontSize: 13, marginTop: 2 },
  ok: { color: colors.primary, fontWeight: '800' },
  allow: { backgroundColor: colors.primary, paddingHorizontal: 16, height: 36, borderRadius: 18, justifyContent: 'center' },
  allowText: { color: '#fff', fontWeight: '800' },
  primary: { marginTop: 10, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  later: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  laterText: { color: colors.muted, fontSize: 16, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 6 },
});
