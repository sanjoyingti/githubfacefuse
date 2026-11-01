import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { ensureInviteCode, inviteLink, resetInviteCode } from '../../lib/invites';
import { Empty } from '../../components/ui';
import { useBottomInset } from '../../components/useBottomInset';
import { APP_NAME, colors } from '../../theme';

/** WhatsApp-style "Invite via link" for group admins. */
export default function InviteViaLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const chat = useChat(id);
  const bottomInset = useBottomInset();
  const [code, setCode] = useState<string | null>(chat?.inviteCode ?? null);
  const isAdmin = !!chat && chat.admins.includes(me.uid);

  useEffect(() => {
    if (!chat || !isAdmin || chat.inviteCode) return;
    ensureInviteCode(chat, me)
      .then(setCode)
      .catch((e) => Alert.alert('Could not make a link', e?.message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id, isAdmin]);

  if (!chat || chat.type !== 'group') return <Empty title="Group not found" />;
  if (!isAdmin) return <Empty title="Only group admins can share the invite link" />;

  const current = chat.inviteCode ?? code;
  const link = current ? inviteLink(current) : '';
  const message = `Join my gym group "${chat.name}" on ${APP_NAME} 💪\n\nTap to join: ${link}\n\n(If you don't have the app yet, the link has a download button. Install it, sign in, then tap the link again.)`;

  const reset = () =>
    Alert.alert('Reset link?', 'The old link will stop working. Anyone who already joined stays in the group.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset link',
        style: 'destructive',
        onPress: () =>
          resetInviteCode(chat, me)
            .then(setCode)
            .catch((e) => Alert.alert('Could not reset', e?.message ?? String(e))),
      },
    ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 24 + bottomInset }}>
      <Text style={styles.h}>🔗 Invite to {chat.name}</Text>
      <Text style={styles.p}>Anyone with this link can join the group after installing {APP_NAME}. Only share it with people you trust.</Text>

      {!link ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
      ) : (
        <>
          <View style={styles.linkBox}>
            <Ionicons name="link" size={22} color={colors.primary} />
            <Text style={styles.link} selectable>
              {link}
            </Text>
          </View>

          <Option
            icon="chatbox-ellipses"
            label="Send link by SMS (text message)"
            onPress={() => Linking.openURL(`sms:?body=${encodeURIComponent(message)}`).catch(() => Share.share({ message }))}
          />
          <Option icon="logo-whatsapp" label="Send link by WhatsApp" onPress={() => Linking.openURL(`whatsapp://send?text=${encodeURIComponent(message)}`).catch(() => Share.share({ message }))} />
          <Option icon="share-social" label="Share link with any app" onPress={() => Share.share({ message })} />
          <Option
            icon="copy"
            label="Copy link"
            onPress={async () => {
              await Clipboard.setStringAsync(link);
              Alert.alert('Copied', 'Invite link copied. Paste it in any message.');
            }}
          />

          <View style={styles.qrCard}>
            <Text style={styles.qrTitle}>📷 Or let them scan this QR code</Text>
            <View style={styles.qrWhite}>
              <QRCode value={link} size={200} />
            </View>
          </View>

          <Option icon="refresh" label="Reset link" danger onPress={reset} />
        </>
      )}
    </ScrollView>
  );
}

function Option({ icon, label, onPress, danger }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={styles.option} onPress={onPress}>
      <View style={[styles.optIcon, danger && { backgroundColor: colors.unpaidBg }]}>
        <Ionicons name={icon} size={22} color={danger ? colors.unpaid : colors.primary} />
      </View>
      <Text style={[styles.optLabel, danger && { color: colors.unpaid }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 22, fontWeight: '900', color: colors.text },
  p: { color: colors.muted, marginTop: 6, marginBottom: 14, fontSize: 15 },
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 12 },
  link: { flex: 1, color: colors.primary, fontWeight: '700', fontSize: 15 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.card, borderRadius: 14, padding: 12, marginBottom: 8 },
  optIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.paidBg, alignItems: 'center', justifyContent: 'center' },
  optLabel: { fontSize: 16, fontWeight: '800', color: colors.text, flex: 1 },
  qrCard: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginVertical: 8, alignItems: 'center' },
  qrTitle: { color: colors.text, fontWeight: '800', marginBottom: 10 },
  qrWhite: { backgroundColor: '#fff', padding: 12, borderRadius: 12 },
});
