import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { setSharing, useGroupLocations, useSharingOn } from '../../lib/liveLocation';
import { mapHtml, pointsForMap } from '../../lib/mapHtml';
import { displayName, useUsers } from '../../lib/users';
import { sendMessage } from '../../lib/chats';
import { Avatar, Empty } from '../../components/ui';
import { useBottomInset } from '../../components/useBottomInset';
import { colors } from '../../theme';
import { CALL_SERVER_URL } from '../../config';
import { BackgroundLocationTips } from '../../components/BackgroundLocationTips';
import type { UserProfile } from '../../lib/types';

// react-native-webview's TypeScript types don't match React 19 yet; the component itself works.
const WebView = RNWebView as unknown as React.ComponentType<any>;

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
};

/** 📍 Live map of a gym group: everyone who has "Share my live location" ON, moving in real time. */
export default function GroupMap() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const chat = useChat(id);
  const bottomInset = useBottomInset();
  const web = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<Record<string, boolean>>({});
  const html = useMemo(() => mapHtml(), []);
  const points = useGroupLocations(id);
  const sharing = useSharingOn();
  const users = useUsers(chat?.members ?? []);

  // Only members of this group are shown (someone removed from the group disappears).
  const mapPoints = useMemo(() => pointsForMap(points.filter((p) => chat?.members.includes(p.uid)), me.uid), [points, chat?.members, me.uid]);
  const send = (m: object) => web.current?.postMessage(JSON.stringify(m));
  useEffect(() => {
    send({ type: 'points', points: mapPoints });
  }, [mapPoints]);

  if (!chat || chat.type !== 'group') return <Empty title="Group not found" subtitle="You may no longer be a member of this group." />;

  const byUid = Object.fromEntries(mapPoints.map((p) => [p.uid, p]));
  const members = chat.members
    .map((uid) => users[uid] ?? ({ uid, name: '…', phone: '' } as UserProfile))
    .sort((a, b) => Number(!!byUid[b.uid]) - Number(!!byUid[a.uid]) || a.name.localeCompare(b.name));
  const count = mapPoints.length;

  // Remind someone whose location is off: a message in the group (they get a notification).
  const ask = async (u: UserProfile) => {
    setAsked((a) => ({ ...a, [u.uid]: true }));
    await sendMessage(chat.id, me, `📍 ${me.name} asked ${u.name} to turn on live location: Me → "Share my live location", or 📍 in this group.`).catch(() => {});
  };

  const toggle = async (on: boolean) => {
    setBusy(true);
    const r = await setSharing(on, me.name);
    setBusy(false);
    if (r === 'denied')
      Alert.alert('Location is not allowed', 'Allow location for Thong Nokbe Gym in the phone settings, then turn sharing on again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
    else if (r === 'on-while-open')
      Alert.alert('Sharing while the app is open', 'To be seen even when the app is closed, set Location to "Allow all the time" for Thong Nokbe Gym in the phone settings.', [
        { text: 'OK', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0f0d' }}>
      <Stack.Screen options={{ title: `📍 ${chat.name}` }} />
      <View style={{ flex: 1 }}>
        <WebView
          ref={web}
          source={{ html, baseUrl: CALL_SERVER_URL }}
          originWhitelist={['*']}
          style={{ flex: 1, backgroundColor: '#0b0f0d' }}
          javaScriptEnabled
          domStorageEnabled
          onMessage={(e: any) => {
            try {
              if (JSON.parse(e.nativeEvent.data)?.ready) send({ type: 'points', points: mapPoints });
            } catch {}
          }}
        />
      </View>

      <View style={[styles.sheet, { paddingBottom: 10 + bottomInset }]}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Share my live location</Text>
            <Text style={styles.switchSub}>{sharing ? 'ON — your groups can see you' : 'OFF — nobody can see you'}</Text>
          </View>
          <Switch value={sharing} onValueChange={toggle} disabled={busy} trackColor={{ true: colors.primary }} />
        </View>
        {sharing && <BackgroundLocationTips myName={me.name} />}

        <Text style={styles.count}>
          {count ? `📍 ${count} of ${chat.members.length} sharing now` : 'Nobody is sharing right now'} · tap a name to find them
        </Text>
        <ScrollView style={{ maxHeight: 200 }}>
          {members.map((u) => {
            const p = byUid[u.uid];
            const isMe = u.uid === me.uid;
            return (
              <Pressable key={u.uid} style={styles.member} onPress={() => (p ? send({ type: 'focus', uid: u.uid }) : null)}>
                <Avatar name={u.name} size={34} color={p ? undefined : '#64748B'} />
                <Text style={styles.memberName} numberOfLines={1}>
                  {isMe ? 'You' : displayName(u)}
                </Text>
                <Text style={[styles.status, { color: p ? colors.primary : colors.muted }]}>{p ? `📍 ${ago(p.updatedMs)}` : 'Location off'}</Text>
                {p && (
                  <Pressable
                    style={styles.gmaps}
                    hitSlop={6}
                    accessibilityLabel={`Open ${isMe ? 'my' : u.name + "'s"} location in Google Maps`}
                    onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`)}
                  >
                    <Text style={styles.gmapsText}>Google Maps</Text>
                  </Pressable>
                )}
                {!p && !isMe && (
                  <Pressable
                    style={[styles.ask, asked[u.uid] && { opacity: 0.5 }]}
                    disabled={asked[u.uid]}
                    onPress={() => ask(u)}
                    hitSlop={6}
                  >
                    <Text style={styles.askText}>{asked[u.uid] ? 'Asked' : 'Ask'}</Text>
                  </Pressable>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.card, paddingHorizontal: 16, paddingTop: 12, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 10, borderBottomWidth: 1, borderColor: colors.border },
  switchTitle: { color: colors.text, fontWeight: '900', fontSize: 17 },
  switchSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  count: { color: colors.muted, fontWeight: '700', fontSize: 13, marginVertical: 8 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  memberName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  status: { fontSize: 13, fontWeight: '700' },
  gmaps: { marginLeft: 8, paddingHorizontal: 10, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.primary, justifyContent: 'center' },
  gmapsText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  ask: { marginLeft: 8, paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: colors.primary, justifyContent: 'center' },
  askText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
