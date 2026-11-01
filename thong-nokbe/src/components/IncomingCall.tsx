import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, query, where } from '@react-native-firebase/firestore';
import { db } from '../lib/firebase';
import { acceptCall, declineCall, RING_TIMEOUT_MS } from '../lib/calls';
import { notifyIfAway } from '../lib/localNotify';
import type { Call, UserProfile } from '../lib/types';
import { colors } from '../theme';
import { Avatar } from './ui';

const notified = new Set<string>();

/** Listens for calls ringing this user and shows a full-screen accept/decline prompt. */
export function IncomingCall({ me }: { me: UserProfile }) {
  const [call, setCall] = useState<Call | null>(null);

  useEffect(() => {
    // ringingFor only lists people who haven't answered or declined yet, so this stays small and needs no index.
    const q = query(collection(db, 'calls'), where('ringingFor', 'array-contains', me.uid));
    return onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        const ringing = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Call, 'id'>) }) as Call)
          .filter(
            (c) =>
              c.status !== 'ended' &&
              !c.joined?.includes(me.uid) &&
              !c.declined?.includes(me.uid) &&
              (!c.createdAt || now - c.createdAt.toMillis() < RING_TIMEOUT_MS),
          );
        const c = ringing[0] ?? null;
        if (c && !notified.has(c.id)) {
          notified.add(c.id);
          const kind = c.kind === 'voice' ? 'voice' : 'video';
          notifyIfAway(
            `${kind === 'video' ? '📹' : '📞'} ${c.isGroup ? c.chatName : c.callerName}`,
            c.isGroup ? `${c.callerName} started a group ${kind} call. Tap to join` : `Incoming ${kind} call. Tap to answer`,
            { kind: 'call', callId: c.id, chatId: c.chatId },
          );
        }
        setCall(c);
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
  const video = call.kind !== 'voice';

  return (
    <Modal visible animationType="fade" onRequestClose={() => {}}>
      <View style={styles.root}>
        <Text style={styles.kind}>{video ? '📹' : '📞'} {call.isGroup ? 'Group ' : ''}{video ? 'Video call' : 'Voice call'}</Text>
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
            <Ionicons name="call" size={34} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            <Text style={styles.btnLabel}>No</Text>
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
            <Ionicons name={video ? 'videocam' : 'call'} size={34} color="#fff" />
            <Text style={styles.btnLabel}>Answer</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.header, paddingTop: 80, alignItems: 'center' },
  kind: { color: '#a7f3d0', fontSize: 20, fontWeight: '800' },
  btnLabel: { position: 'absolute', bottom: -30, color: '#fff', fontWeight: '800', fontSize: 16 },
  name: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 20, textAlign: 'center', paddingHorizontal: 20 },
  sub: { color: '#cbd5e1', marginTop: 6 },
  actions: { position: 'absolute', bottom: 80, flexDirection: 'row', width: '100%', justifyContent: 'space-evenly' },
  circle: { width: 86, height: 86, borderRadius: 43, alignItems: 'center', justifyContent: 'center' },
});
