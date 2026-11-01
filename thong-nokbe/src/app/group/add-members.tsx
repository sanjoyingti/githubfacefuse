import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { addMembers } from '../../lib/chats';
import { MemberPicker, type Selection } from '../../components/MemberPicker';
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

  if (!chat || !chat.admins.includes(me.uid)) return <Empty title="Only group admins can add members" />;

  const save = async () => {
    setBusy(true);
    try {
      await addMembers(chat, me, sel.users, sel.phones);
      router.back();
    } catch (e: any) {
      Alert.alert('Could not add members', e?.message ?? String(e));
      setBusy(false);
    }
  };

  const n = sel.users.length + sel.phones.length;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MemberPicker meUid={me.uid} excludeUids={chat.members} excludePhones={chat.pendingPhones} value={sel} onChange={setSel} />
      <View style={{ padding: 12, paddingBottom: 12 + bottomInset, backgroundColor: '#fff', borderTopWidth: 1, borderColor: colors.border }}>
        <Button title={n ? `Add ${n} member(s)` : 'Select members'} disabled={!n} onPress={save} loading={busy} />
      </View>
    </View>
  );
}
