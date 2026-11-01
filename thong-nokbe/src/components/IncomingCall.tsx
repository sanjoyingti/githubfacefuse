import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, query, where } from '@react-native-firebase/firestore';
import { db } from '../lib/firebase';
import { acceptCall, declineCall, RING_TIMEOUT_MS } from '../lib/calls';
import type { Call, UserProfile } from '../lib/types';
import { colors } from '../theme';
import { Avatar } from './ui';

/** Listens for calls ringing this user and shows a full-screen accept/decline prompt. */
export function IncomingCall({ me }: { me: UserProfile }) {
  const [call, setCall] = useState<Call | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'calls'), where('invited', 'array-contains', me.uid), where('status', 'in', ['ringing', 'ongoing']));
    return onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        const ringing = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Call, 'id'>) }) as Call)
          .filter(
            (c) =>
              !c.joined?.includes(me.uid) &&
              !c.declined?.includes(me.uid) &&
              (!c.createdAt || now - c.createdAt.toMillis() < RING_TIMEOUT_MS),
          );
        setCall(ringing[0] ?? null);
      },
      (e) => console.warn('incoming call listener', e),
    );
  }, [me.uid]);

  // Stop ringing after the timeout even if nothing changes in Firestore.
  useEffect(() => {
    if (!call?.createdAt) return;
    const left = RING_TIMEOUT_MS - (Date.now() - call.createdAt.toMillis());
    const t = setTimeout(() => setCall(null), Math.max(0, left));
    return () => clearTimeout(t);
  }, [call]);

  if (!call) return null;
  const title = call.isGroup ? call.chatName : call.callerName;

  return (
    <Modal visible animationType="fade" onRequestClose={() => {}}>
      <View style={styles.root}>
        <Text style={styles.kind}>{call.isGroup ? 'Incoming group video call' : 'Incoming video call'}</Text>
        <View style={{ alignItems: 'center', marginTop: 40 }}>
          <Avatar name={title} size={120} />
          <Text style={styles.name}>{title}</Text>
          {call.isGroup && <Text style={styles.sub}>{call.callerName} is calling…</Text>}
        </View>
        <View style={styles.actions}>
          <Pressable
            style={[styles.circle, { backgroundColor: colors.unpaid }]}
            onPress={() => {
              declineCall(call.id, me).catch(() => {});
              setCall(null);
            }}
          >
            <Ionicons name="call" size={32} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
          <Pressable
            style={[styles.circle, { backgroundColor: colors.primary }]}
            onPress={async () => {
              const id = call.id;
              setCall(null);
              await acceptCall(id, me).catch(() => {});
              router.push(`/call/${id}`);
            }}
          >
            <Ionicons name="videocam" size={32} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.header, paddingTop: 80, alignItems: 'center' },
  kind: { color: '#a7f3d0', fontSize: 15, letterSpacing: 0.5 },
  name: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 20, textAlign: 'center', paddingHorizontal: 20 },
  sub: { color: '#cbd5e1', marginTop: 6 },
  actions: { position: 'absolute', bottom: 80, flexDirection: 'row', width: '100%', justifyContent: 'space-evenly' },
  circle: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
});
