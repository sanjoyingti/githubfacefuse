import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useMe } from '../context/AuthProvider';
import { getOrCreateDirectChat } from '../lib/chats';
import { MemberPicker, type Selection } from '../components/MemberPicker';
import { colors } from '../theme';

export default function NewChat() {
  const me = useMe();
  const [sel, setSel] = useState<Selection>({ users: [], phones: [] });

  useEffect(() => {
    const other = sel.users[0];
    if (!other) return;
    getOrCreateDirectChat(me, other)
      .then((id) => router.replace(`/chat/${id}`))
      .catch((e) => Alert.alert('Could not open chat', e?.message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.users[0]?.uid]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MemberPicker meUid={me.uid} value={sel} onChange={setSel} single />
    </View>
  );
}
