import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { addMembers } from '../../lib/chats';
import { ensureInviteCode, groupInviteMessage, rememberInvitedNumber, sendInvite } from '../../lib/invites';
import { MemberPicker, type Selection } from '../../components/MemberPicker';
import { ActionSheet, type SheetOption } from '../../components/ActionSheet';
import { Button, Empty } from '../../components/ui';
import { colors } from '../../theme';
import { useBottomInset } from '../../components/useBottomInset';

export default function AddMembers() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const bottomInset = useBottomInset();
  const chat = useChat(id);
  const [sel, setSel] = useState<Selection>({ users: [], phones: [] });
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<{ title: string; options: SheetOption[] } | null>(null);

  if (!chat || !chat.admins.includes(me.uid)) return <Empty title="Only group admins can add members" />;

  // People already on the app are added straight away and appear in the group at once.
  const save = async () => {
    setBusy(true);
    try {
      await addMembers(chat, me, sel.users, []);
      const names = sel.users.map((u) => u.name).join(', ');
      Alert.alert('Added ✅', `${names} ${sel.users.length > 1 ? 'are' : 'is'} now in “${chat.name}”.`);
      router.back();
    } catch (e: any) {
      Alert.alert('Could not add members', e?.message ?? String(e));
      setBusy(false);
    }
  };

  // Someone not on the app: send this group's invite link straight to their number.
  const inviteNonUser = async (r: { name: string; phone: string }) => {
    try {
      const code = await ensureInviteCode(chat, me);
      await rememberInvitedNumber(chat, r.phone); // they join by themselves once they register with this number
      const message = groupInviteMessage(chat.name ?? 'Gym', code, r.name);
      setSheet({
        title: `Invite ${r.name}`,
        options: [
          { label: 'WhatsApp', icon: 'logo-whatsapp', onPress: () => sendInvite('whatsapp', r.phone, message).catch(() => sendInvite('other', r.phone, message)) },
          { label: 'SMS (text message)', icon: 'chatbubble-ellipses', onPress: () => sendInvite('sms', r.phone, message).catch(() => sendInvite('other', r.phone, message)) },
          { label: 'Other apps', icon: 'share-social', onPress: () => sendInvite('other', r.phone, message) },
        ],
      });
    } catch (e: any) {
      Alert.alert('Could not make the invite link', e?.message ?? String(e));
    }
  };

  const n = sel.users.length;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MemberPicker meUid={me.uid} excludeUids={chat.members} excludePhones={chat.pendingPhones} value={sel} onChange={setSel} onInviteNonUser={inviteNonUser} />
      <View style={{ padding: 12, paddingBottom: 12 + bottomInset, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border }}>
        <Button title={n ? `Add ${n} member${n > 1 ? 's' : ''}` : 'Select people on the app'} disabled={!n} onPress={save} loading={busy} />
      </View>
      <ActionSheet title={sheet?.title ?? null} options={sheet?.options ?? []} onClose={() => setSheet(null)} />
    </View>
  );
}
