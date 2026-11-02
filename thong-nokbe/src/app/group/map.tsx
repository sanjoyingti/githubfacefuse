import React, { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { startSharing, stopSharing, useGroupLocations, useIsSharing } from '../../lib/liveLocation';
import { mapHtml, pointsForMap } from '../../lib/mapHtml';
import { Empty } from '../../components/ui';
import { useBottomInset } from '../../components/useBottomInset';
import { colors } from '../../theme';

const WebView = RNWebView as unknown as React.ComponentType<any>;

export default function GroupMap() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const chat = useChat(id);
  const bottomInset = useBottomInset();
  const web = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  const html = useMemo(() => mapHtml(), []);
  const points = useGroupLocations(id);
  const sharing = useIsSharing(id);

  const mapPoints = useMemo(() => pointsForMap(points), [points]);
  const push = () => web.current?.postMessage(JSON.stringify(mapPoints));
  // Re-send whenever the points change (and once the map says it is ready).
  React.useEffect(push, [mapPoints]);

  if (!chat || chat.type !== 'group') return <Empty title="Group not found" subtitle="" />;

  const sharingCount = points.filter((p) => p.sharing !== false).length;

  const turnOn = async () => {
    setBusy(true);
    const r = await startSharing(id, me.name);
    setBusy(false);
    if (r === 'denied') Alert.alert('Location is off', 'Allow location for Thong Nokbe Gym to share with your group. Open the app settings and turn Location on.');
    else if (r === 'denied-background')
      Alert.alert('Works while the app is open', 'You chose "While using the app", so your location updates only while Thong Nokbe Gym is open. For the group to see you even when the app is closed, set Location to "Allow all the time" in settings.');
  };
  const turnOff = () =>
    Alert.alert('Stop sharing location?', 'Your group will no longer see where you are.', [
      { text: 'Keep sharing', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => stopSharing(id) },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0f0d' }}>
      <Stack.Screen options={{ title: `📍 ${chat.name} — live map` }} />
      <WebView
        ref={web}
        source={{ html }}
        originWhitelist={['*']}
        style={{ flex: 1, backgroundColor: '#0b0f0d' }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={(e: any) => {
          try {
            if (JSON.parse(e.nativeEvent.data)?.ready) push();
          } catch {}
        }}
      />
      <View style={[styles.bar, { paddingBottom: 14 + bottomInset }]}>
        <Text style={styles.count}>
          {sharingCount > 0 ? `📍 ${sharingCount} member${sharingCount > 1 ? 's' : ''} sharing now` : 'No one is sharing their location yet'}
        </Text>
        {sharing ? (
          <Pressable style={[styles.btn, styles.off]} onPress={turnOff}>
            <Ionicons name="location" size={20} color="#fff" />
            <Text style={styles.btnText}>Stop sharing my location</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} onPress={turnOn} disabled={busy}>
            <Ionicons name="location-outline" size={20} color="#fff" />
            <Text style={styles.btnText}>{busy ? 'Starting…' : 'Share my live location'}</Text>
          </Pressable>
        )}
        <Text style={styles.note}>Only members of this group can see it. You can stop any time, and your phone shows a notice while it is on.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.card, paddingHorizontal: 16, paddingTop: 14, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  count: { color: colors.text, fontWeight: '800', fontSize: 15, textAlign: 'center', marginBottom: 10 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 54, borderRadius: 27, backgroundColor: colors.primary },
  off: { backgroundColor: colors.unpaid },
  btnText: { color: '#fff', fontWeight: '900', fontSize: 17 },
  note: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 10 },
});
