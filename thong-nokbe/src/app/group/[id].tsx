import React, { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { cancelInvite, dismissAdmin, getOrCreateDirectChat, leaveGroup, makeAdmin, removeMember, updateGroupInfo } from '../../lib/chats';
import { startCall } from '../../lib/calls';
import { displayName, useUsers } from '../../lib/users';
import { formatPhone } from '../../lib/phone';
import { Avatar, Button, Chip, Empty } from '../../components/ui';
import { APP_INVITE_LINK } from '../../config';
import { APP_NAME, colors } from '../../theme';
import type { UserProfile } from '../../lib/types';

function choose(title: string, options: { label: string; destructive?: boolean; onPress: () => void }[]) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...options.map((o) => o.label), 'Cancel'], cancelButtonIndex: options.length, destructiveButtonIndex: options.findIndex((o) => o.destructive) },
      (i) => i < options.length && options[i].onPress(),
    );
  } else {
    Alert.alert(title, undefined, [...options.map((o) => ({ text: o.label, onPress: o.onPress, style: o.destructive ? ('destructive' as const) : undefined })), { text: 'Cancel', style: 'cancel' as const }], {
      cancelable: true,
    });
  }
}

export default function GroupInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const chat = useChat(id);
  const users = useUsers(chat?.members ?? []);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  if (!chat || chat.type !== 'group') return <Empty title="Group not found" subtitle="You may no longer be a member of this group." />;
  const iAmAdmin = chat.admins.includes(me.uid);

  const run = (fn: () => Promise<unknown>) => fn().catch((e) => Alert.alert('Something went wrong', e?.message ?? String(e)));

  const onMember = (u: UserProfile) => {
    if (u.uid === me.uid) return;
    const isAdmin = chat.admins.includes(u.uid);
    const opts: { label: string; destructive?: boolean; onPress: () => void }[] = [
      { label: `Message ${u.name}`, onPress: () => run(async () => router.push(`/chat/${await getOrCreateDirectChat(me, u)}`)) },
      {
        label: `Video call ${u.name}`,
        onPress: () =>
          run(async () => {
            const dm = await getOrCreateDirectChat(me, u);
            router.push(`/call/${await startCall({ ...chat, id: dm, type: 'direct', members: [me.uid, u.uid] }, me, u.name, u.uid)}`);
          }),
      },
    ];
    if (iAmAdmin) {
      opts.push(
        isAdmin
          ? { label: 'Dismiss as admin', onPress: () => run(() => dismissAdmin(chat, me, u)) }
          : { label: 'Make group admin', onPress: () => run(() => makeAdmin(chat, me, u)) },
        {
          label: `Remove ${u.name}`,
          destructive: true,
          onPress: () =>
            Alert.alert(`Remove ${u.name}?`, `${u.name} will be removed from "${chat.name}".`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => run(() => removeMember(chat, me, u)) },
            ]),
        },
      );
    }
    choose(u.name, opts);
  };

  const members = chat.members
    .map((uid) => users[uid] ?? ({ uid, name: 'Loading…', phone: '' } as UserProfile))
    .sort((a, b) => Number(chat.admins.includes(b.uid)) - Number(chat.admins.includes(a.uid)) || a.name.localeCompare(b.name));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.header}>
        <Avatar name={chat.name} size={90} />
        {editing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 }}>
            <TextInput value={name} onChangeText={setName} style={styles.nameInput} autoFocus />
            <Button
              small
              title="Save"
              onPress={() =>
                run(async () => {
                  if (name.trim()) await updateGroupInfo(chat.id, { name: name.trim() });
                  setEditing(false);
                })
              }
            />
          </View>
        ) : (
          <Pressable
            disabled={!iAmAdmin}
            onPress={() => {
              setName(chat.name ?? '');
              setEditing(true);
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}
          >
            <Text style={styles.groupName}>{chat.name}</Text>
            {iAmAdmin && <Ionicons name="pencil" size={16} color={colors.muted} />}
          </Pressable>
        )}
        <Text style={{ color: colors.muted, marginTop: 4 }}>Group · {chat.members.length} members</Text>
      </View>

      {iAmAdmin && (
        <View style={styles.section}>
          <Row icon="person-add" label="Add members" onPress={() => router.push({ pathname: '/group/add-members', params: { id: chat.id } })} />
          <Row icon="qr-code" label="Fee & UPI payment settings" onPress={() => router.push({ pathname: '/group/fee-settings', params: { id: chat.id } })} />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{chat.members.length} members</Text>
        {members.map((u) => (
          <Pressable key={u.uid} style={styles.member} onPress={() => onMember(u)}>
            <Avatar name={u.name} size={42} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.memberName}>{u.uid === me.uid ? 'You' : displayName(u)}</Text>
              <Text style={styles.memberSub}>{u.phone ? formatPhone(u.phone) : ''}</Text>
            </View>
            {chat.admins.includes(u.uid) && <Chip text="Group admin" color={colors.primaryDark} bg={colors.paidBg} />}
          </Pressable>
        ))}
      </View>

      {chat.pendingPhones.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Invited · waiting to install {APP_NAME}</Text>
          {chat.pendingPhones.map((p) => (
            <View key={p} style={styles.member}>
              <Avatar name="?" size={42} color="#94A3B8" />
              <Text style={[styles.memberName, { flex: 1, marginLeft: 12 }]}>{formatPhone(p)}</Text>
              <Pressable
                onPress={() => Share.share({ message: `Join our gym group "${chat.name}" on ${APP_NAME}. Install the app and sign in with ${p}: ${APP_INVITE_LINK}` })}
                hitSlop={8}
              >
                <Ionicons name="share-social" size={22} color={colors.primary} />
              </Pressable>
              {iAmAdmin && (
                <Pressable onPress={() => run(() => cancelInvite(chat, p))} hitSlop={8} style={{ marginLeft: 16 }}>
                  <Ionicons name="close-circle" size={22} color={colors.unpaid} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Row
          icon="exit-outline"
          label="Exit group"
          danger
          onPress={() =>
            Alert.alert('Exit group?', `You will stop receiving messages from "${chat.name}".`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Exit',
                style: 'destructive',
                onPress: () =>
                  run(async () => {
                    await leaveGroup(chat, me);
                    router.dismissAll();
                  }),
              },
            ])
          }
        />
      </View>
    </ScrollView>
  );
}

function Row({ icon, label, onPress, danger }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Ionicons name={icon} size={22} color={danger ? colors.unpaid : colors.primary} />
      <Text style={[styles.rowLabel, danger && { color: colors.unpaid }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', backgroundColor: '#fff', paddingVertical: 24, marginBottom: 10 },
  groupName: { fontSize: 22, fontWeight: '800', color: colors.text },
  nameInput: { borderBottomWidth: 2, borderColor: colors.primary, fontSize: 20, minWidth: 180, color: colors.text, paddingVertical: 4 },
  section: { backgroundColor: '#fff', marginBottom: 10, paddingVertical: 4 },
  sectionTitle: { color: colors.muted, fontWeight: '700', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  member: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  memberName: { fontSize: 16, fontWeight: '600', color: colors.text },
  memberSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  rowLabel: { fontSize: 16, color: colors.text, fontWeight: '600' },
});
