import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMe } from '../../context/AuthProvider';
import { useChats } from '../../context/ChatsProvider';
import { getInvite, joinWithCode } from '../../lib/invites';
import { clearPendingInvite } from '../../lib/pendingInvite';
import { Avatar, Button } from '../../components/ui';
import { APP_NAME, colors } from '../../theme';

/** Opened from a WhatsApp-style invite link: "Join <group>?" */
export default function JoinGroup() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const me = useMe();
  const { chats } = useChats();
  const [invite, setInvite] = useState<{ chatId: string; name: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    clearPendingInvite();
    if (!code) return;
    getInvite(code)
      .then(setInvite)
      .catch(() => setInvite(null));
  }, [code]);

  if (invite === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (!invite) {
    return (
      <View style={styles.center}>
        <Text style={styles.big}>😕</Text>
        <Text style={styles.title}>Link not working</Text>
        <Text style={styles.sub}>This invite link has expired or was reset. Ask the group admin for a new link.</Text>
        <Button title="OK" onPress={() => router.replace('/(tabs)/chats')} style={{ marginTop: 20, alignSelf: 'stretch' }} />
      </View>
    );
  }

  const already = chats.some((c) => c.id === invite.chatId);
  const join = async () => {
    setBusy(true);
    try {
      const chatId = await joinWithCode(code!, me);
      router.replace(`/chat/${chatId}`);
    } catch (e: any) {
      Alert.alert('Could not join', e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <View style={styles.center}>
      <Avatar name={invite.name} size={110} />
      <Text style={styles.title}>{invite.name}</Text>
      <Text style={styles.sub}>{already ? "You're already in this group." : `You've been invited to join this gym group on ${APP_NAME}.`}</Text>
      {already ? (
        <Button title="Open group" onPress={() => router.replace(`/chat/${invite.chatId}`)} style={{ marginTop: 24, alignSelf: 'stretch' }} />
      ) : (
        <>
          <Button title="✅ Join group" onPress={join} loading={busy} style={{ marginTop: 24, alignSelf: 'stretch' }} />
          <Button title="Not now" variant="ghost" onPress={() => router.replace('/(tabs)/chats')} style={{ marginTop: 8, alignSelf: 'stretch' }} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.bg },
  big: { fontSize: 56 },
  title: { fontSize: 26, fontWeight: '900', color: colors.text, marginTop: 16, textAlign: 'center' },
  sub: { color: colors.muted, fontSize: 16, marginTop: 8, textAlign: 'center' },
});
