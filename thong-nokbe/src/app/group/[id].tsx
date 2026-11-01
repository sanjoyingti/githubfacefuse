import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { approveJoin, cancelInvite, dismissAdmin, getOrCreateDirectChat, isMainAdmin, leaveGroup, makeAdmin, rejectJoin, removeMember, stepDownAdmin, updateGroupInfo } from '../../lib/chats';
import { hasApp } from '../../lib/calls';
import { inviteLink, syncInviteName } from '../../lib/invites';
import { useCaller } from '../../components/useCaller';
import { displayName, useUsers } from '../../lib/users';
import { formatPhone } from '../../lib/phone';
import { Avatar, Button, Chip, Empty } from '../../components/ui';
import { CallButtons } from '../../components/CallButtons';
import { APP_INVITE_LINK } from '../../config';
import { APP_NAME, colors } from '../../theme';
import type { UserProfile } from '../../lib/types';
import { useBottomInset } from '../../components/useBottomInset';
import { ActionSheet, type SheetOption } from '../../components/ActionSheet';

export default function GroupInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const bottomInset = useBottomInset();
  const chat = useChat(id);
  const users = useUsers([...(chat?.members ?? []), ...(chat?.joinRequests ?? [])]);
  const { callChat, callUser } = useCaller();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [sheet, setSheet] = useState<{ title: string; options: SheetOption[] } | null>(null);

  if (!chat || chat.type !== 'group') return <Empty title="Group not found" subtitle="You may no longer be a member of this group." />;
  const iAmAdmin = chat.admins.includes(me.uid);
  const iAmMain = isMainAdmin(chat, me.uid);

  const run = (fn: () => Promise<unknown>) => fn().catch((e) => Alert.alert('Something went wrong', e?.message ?? String(e)));

  // The main admin can remove anyone; second admins can remove normal members only.
  const canRemove = (u: UserProfile) => u.uid !== me.uid && (iAmMain || (iAmAdmin && !chat.admins.includes(u.uid)));
  const confirmRemove = (u: UserProfile) =>
    Alert.alert(`Remove ${u.name}?`, `${u.name} will be removed from "${chat.name}".`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => run(() => removeMember(chat, me, u)) },
    ]);

  const onMember = (u: UserProfile) => {
    if (u.uid === me.uid) return;
    const isAdmin = chat.admins.includes(u.uid);
    const opts: SheetOption[] = [
      { label: `Message ${u.name}`, icon: 'chatbubble', onPress: () => run(async () => router.push(`/chat/${await getOrCreateDirectChat(me, u)}`)) },
      ...(hasApp(u)
        ? [
            { label: `Voice call ${u.name}`, icon: 'call' as const, onPress: () => callUser(u, 'voice') },
            { label: `Video call ${u.name}`, icon: 'videocam' as const, onPress: () => callUser(u, 'video') },
          ]
        : []),
    ];
    // Only the main admin appoints or dismisses admins. Second admins can remove normal members only.
    if (iAmMain) {
      opts.push(
        isAdmin
          ? { label: 'Dismiss as admin', icon: 'arrow-down-circle', onPress: () => run(() => dismissAdmin(chat, me, u)) }
          : { label: 'Make second admin ⭐', icon: 'star', onPress: () => run(() => makeAdmin(chat, me, u)) },
      );
    }
    if (canRemove(u)) {
      opts.push({ label: `Remove ${u.name} from group`, icon: 'person-remove', destructive: true, onPress: () => confirmRemove(u) });
    }
    setSheet({ title: u.name, options: opts });
  };

  const members = chat.members
    .map((uid) => users[uid] ?? ({ uid, name: 'Loading…', phone: '' } as UserProfile))
    .sort((a, b) => Number(chat.admins.includes(b.uid)) - Number(chat.admins.includes(a.uid)) || a.name.localeCompare(b.name));

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 + bottomInset }}>
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
                  if (name.trim()) {
                    await updateGroupInfo(chat.id, { name: name.trim() });
                    await syncInviteName({ ...chat, name: name.trim() });
                  }
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
        <View style={{ marginTop: 14 }}>
          <CallButtons onCall={(kind) => callChat(chat, chat.name ?? 'Group', kind)} />
        </View>
      </View>

      {iAmAdmin && (
        <View style={styles.section}>
          <Row icon="person-add" label="Add members" onPress={() => router.push({ pathname: '/group/add-members', params: { id: chat.id } })} />
          <Row icon="link" label="Invite via link (SMS, WhatsApp, QR)" onPress={() => router.push({ pathname: '/group/invite', params: { id: chat.id } })} />
          <Row icon="stats-chart" label="Fee report (who paid how much)" onPress={() => router.push({ pathname: '/group/fee-report', params: { id: chat.id } })} />
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
            {isMainAdmin(chat, u.uid) ? (
              <Chip text="👑 Main admin" color={colors.accent} bg={colors.warnBg} />
            ) : chat.admins.includes(u.uid) ? (
              <Chip text="⭐ Admin" color={colors.primary} bg={colors.paidBg} />
            ) : !hasApp(u) && u.uid !== me.uid ? (
              <Chip text="Not on app" color={colors.unpaid} bg={colors.unpaidBg} />
            ) : null}
            {canRemove(u) && (
              <Pressable onPress={() => confirmRemove(u)} hitSlop={10} style={styles.removeBtn} accessibilityLabel={`Remove ${u.name}`}>
                <Ionicons name="person-remove" size={18} color={colors.unpaid} />
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            )}
          </Pressable>
        ))}
      </View>

      {iAmAdmin && (chat.joinRequests?.length ?? 0) > 0 && (
        <View style={[styles.section, { borderLeftWidth: 5, borderColor: colors.accent }]}>
          <Text style={styles.sectionTitle}>🙋 Waiting for your approval</Text>
          {chat.joinRequests!.map((uid) => {
            const u = users[uid];
            if (!u) return null;
            return (
              <View key={uid} style={styles.member}>
                <Avatar name={u.name} size={42} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.memberName}>{u.name}</Text>
                  <Text style={styles.memberSub}>{formatPhone(u.phone)}{u.email ? ` · ${u.email}` : ''}</Text>
                </View>
                <Button small title="✓ Add" onPress={() => run(() => approveJoin(chat, me, u))} />
                <Pressable onPress={() => run(() => rejectJoin(chat, u))} hitSlop={8} style={{ marginLeft: 12 }}>
                  <Ionicons name="close-circle" size={28} color={colors.unpaid} />
                </Pressable>
              </View>
            );
          })}
          <Text style={[styles.memberSub, { paddingHorizontal: 16, paddingBottom: 10 }]}>
            Only add people you know. Phone numbers aren't checked by SMS in the free version.
          </Text>
        </View>
      )}

      {chat.pendingPhones.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Invited · they join automatically after installing {APP_NAME}</Text>
          {chat.pendingPhones.map((p) => (
            <View key={p} style={styles.member}>
              <Avatar name="?" size={42} color="#94A3B8" />
              <Text style={[styles.memberName, { flex: 1, marginLeft: 12 }]}>{formatPhone(p)}</Text>
              <Pressable
                onPress={() =>
                  Share.share({
                    message: chat.inviteCode
                      ? `Join our gym group "${chat.name}" on ${APP_NAME} 💪 Tap to join: ${inviteLink(chat.inviteCode)}`
                      : `Join our gym group "${chat.name}" on ${APP_NAME}. Install the app and sign in with ${p}: ${APP_INVITE_LINK}`,
                  })
                }
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

      {iAmAdmin && !iAmMain && (
        <View style={styles.section}>
          <Row
            icon="arrow-down-circle-outline"
            label="Step down as admin"
            danger
            onPress={() =>
              Alert.alert('Step down as admin?', 'You will stay in the group as a normal member. Only the main admin can make you admin again.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Step down', style: 'destructive', onPress: () => run(() => stepDownAdmin(chat, me)) },
              ])
            }
          />
        </View>
      )}

      {iAmMain && <Text style={styles.adminHint}>👑 You are the main admin. Tap a member to make them a ⭐ second admin.</Text>}

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
      <ActionSheet title={sheet?.title ?? null} options={sheet?.options ?? []} onClose={() => setSheet(null)} />
    </>
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
  header: { alignItems: 'center', backgroundColor: colors.card, paddingVertical: 24, marginBottom: 10 },
  groupName: { fontSize: 22, fontWeight: '800', color: colors.text },
  nameInput: { borderBottomWidth: 2, borderColor: colors.primary, fontSize: 20, minWidth: 180, color: colors.text, paddingVertical: 4 },
  section: { backgroundColor: colors.card, marginBottom: 10, paddingVertical: 4 },
  sectionTitle: { color: colors.muted, fontWeight: '700', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  member: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8, paddingHorizontal: 10, height: 34, borderRadius: 17, backgroundColor: colors.unpaidBg },
  removeText: { color: colors.unpaid, fontWeight: '800', fontSize: 13 },
  memberName: { fontSize: 16, fontWeight: '600', color: colors.text },
  memberSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  adminHint: { color: colors.muted, paddingHorizontal: 16, marginBottom: 10, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  rowLabel: { fontSize: 16, color: colors.text, fontWeight: '600' },
});
