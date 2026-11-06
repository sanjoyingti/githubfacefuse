import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useMe } from '../context/AuthProvider';
import { useChats } from '../context/ChatsProvider';
import { createGroup } from '../lib/chats';
import { MemberPicker, type Selection } from '../components/MemberPicker';
import { Button, Input } from '../components/ui';
import { APP_NAME, colors } from '../theme';
import { useBottomInset } from '../components/useBottomInset';

export default function NewGroup() {
  const me = useMe();
  const bottomInset = useBottomInset();
  const { selectGroup } = useChats();
  const [name, setName] = useState('');
  const [sel, setSel] = useState<Selection>({ users: [], phones: [] });
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return Alert.alert('Group name', 'Give your group a name, e.g. "Thong Nokbe Gym – Morning batch".');
    setBusy(true);
    try {
      const id = await createGroup(me, name, sel.users.map((u) => u.uid), sel.phones);
      selectGroup(id);
      router.replace(`/chat/${id}`);
      // Each group collects fees to its creator's own UPI ID, used only for this group.
      const notOnApp = sel.phones.length;
      Alert.alert(
        'Group created ✅',
        (notOnApp ? `${notOnApp} of the people you chose ${notOnApp > 1 ? "aren't" : "isn't"} on ${APP_NAME} yet — send them the group's invite link so they can install the app and join.\n\n` : '') +
          `Add your UPI ID so members of “${name.trim()}” can pay fees to you. It is used only for this group.`,
        [
          { text: 'Later', style: 'cancel' },
          ...(notOnApp ? [{ text: 'Invite link', onPress: () => router.push({ pathname: '/group/invite', params: { id } }) }] : []),
          { text: 'Add UPI', onPress: () => router.push({ pathname: '/group/fee-settings', params: { id } }) },
        ],
      );
    } catch (e: any) {
      Alert.alert('Could not create group', e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 12, paddingBottom: 0 }}>
        <Input label="Group name" placeholder="e.g. Iron Paradise Gym" value={name} onChangeText={setName} />
      </View>
      <MemberPicker meUid={me.uid} value={sel} onChange={setSel} />
      <View style={{ padding: 12, paddingBottom: 12 + bottomInset, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border }}>
        <Button
          title={`Create group${sel.users.length + sel.phones.length ? ` with ${sel.users.length + sel.phones.length} member(s)` : ''}`}
          onPress={create}
          loading={busy}
        />
      </View>
    </View>
  );
}
