import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMe } from '../../context/AuthProvider';
import { useChats } from '../../context/ChatsProvider';
import { useContacts } from '../../lib/contacts';
import { hasApp } from '../../lib/calls';
import { formatPhone } from '../../lib/phone';
import { refreshUsers, useUsers } from '../../lib/users';
import { CallButtons } from '../../components/CallButtons';
import { useCaller } from '../../components/useCaller';
import { Avatar } from '../../components/ui';
import { APP_INVITE_LINK } from '../../config';
import { APP_NAME, colors } from '../../theme';
import type { Chat, UserProfile } from '../../lib/types';

type Item = { kind: 'group'; chat: Chat } | { kind: 'person'; user: UserProfile; label: string };

export default function Calls() {
  const me = useMe();
  const { chats, groups } = useChats();
  const { rows: contacts } = useContacts();
  const { callChat, callUser } = useCaller();
  const [search, setSearch] = useState('');

  // Everyone I share a chat with, plus contacts who use the app.
  const chatUids = useMemo(() => [...new Set(chats.flatMap((c) => c.members))].filter((u) => u !== me.uid), [chats, me.uid]);
  const chatUsers = useUsers(chatUids);
  const contactName = useMemo(() => new Map(contacts.filter((c) => c.user).map((c) => [c.user!.uid, c.name])), [contacts]);

  useFocusEffect(
    useCallback(() => {
      refreshUsers([...chatUids, ...contactName.keys()]);
    }, [chatUids, contactName]),
  );

  const people = useMemo(() => {
    const map = new Map<string, UserProfile>();
    Object.values(chatUsers).forEach((u) => map.set(u.uid, u));
    contacts.forEach((c) => c.user && c.user.uid !== me.uid && !map.has(c.user.uid) && map.set(c.user.uid, c.user));
    return [...map.values()]
      .map((user) => ({ user, label: contactName.get(user.uid) || user.name }))
      .sort((a, b) => Number(hasApp(b.user)) - Number(hasApp(a.user)) || a.label.localeCompare(b.label));
  }, [chatUsers, contacts, contactName, me.uid]);

  const q = search.trim().toLowerCase();
  const sections: { title: string; data: Item[] }[] = [
    { title: '🏋️  Call my whole gym group', data: groups.filter((g) => !q || (g.name ?? '').toLowerCase().includes(q)).map((chat) => ({ kind: 'group' as const, chat })) },
    {
      title: '👤  Call one person',
      data: people.filter((p) => !q || p.label.toLowerCase().includes(q) || p.user.phone.includes(q)).map((p) => ({ kind: 'person' as const, ...p })),
    },
  ].filter((s) => s.data.length);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={20} color={colors.muted} />
        <TextInput style={styles.search} placeholder="Find a name" value={search} onChangeText={setSearch} placeholderTextColor={colors.muted} />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(i) => (i.kind === 'group' ? i.chat.id : i.user.uid)}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        ListEmptyComponent={
          <View style={{ padding: 32, alignItems: 'center' }}>
            <Text style={{ fontSize: 40 }}>📞</Text>
            <Text style={styles.emptyTitle}>Nobody to call yet</Text>
            <Text style={styles.emptyText}>Friends who install {APP_NAME} will appear here.</Text>
          </View>
        }
        renderItem={({ item }) =>
          item.kind === 'group' ? (
            <View style={styles.card}>
              <Avatar name={item.chat.name} size={50} />
              <View style={styles.middle}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.chat.name}
                </Text>
                <Text style={styles.sub}>Rings all {item.chat.members.length - 1} members</Text>
              </View>
              <CallButtons compact onCall={(kind) => callChat(item.chat, item.chat.name ?? 'Group', kind)} />
            </View>
          ) : (
            <View style={styles.card}>
              <Avatar name={item.label} size={50} color={hasApp(item.user) ? undefined : '#94A3B8'} />
              <View style={styles.middle}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={[styles.sub, !hasApp(item.user) && { color: colors.unpaid }]}>
                  {hasApp(item.user) ? formatPhone(item.user.phone) : 'Not on the app now'}
                </Text>
              </View>
              {hasApp(item.user) ? (
                <CallButtons compact onCall={(kind) => callUser(item.user, kind)} />
              ) : (
                <Pressable
                  style={styles.invite}
                  onPress={() => Share.share({ message: `Install ${APP_NAME} so we can call each other: ${APP_INVITE_LINK}` })}
                >
                  <Text style={{ color: colors.primary, fontWeight: '800' }}>Invite</Text>
                </Pressable>
              )}
            </View>
          )
        }
        ListFooterComponent={
          <Pressable style={styles.footer} onPress={() => Share.share({ message: `Join me on ${APP_NAME}: ${APP_INVITE_LINK}` })}>
            <Ionicons name="share-social" size={20} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 16 }}>Invite a friend to the app</Text>
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border },
  search: { flex: 1, height: 48, fontSize: 17, color: colors.text },
  section: { fontSize: 15, fontWeight: '800', color: colors.text, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8, borderRadius: 16, padding: 12 },
  middle: { flex: 1, marginHorizontal: 12 },
  name: { fontSize: 17, fontWeight: '800', color: colors.text },
  sub: { color: colors.muted, marginTop: 2 },
  invite: { borderWidth: 2, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, height: 40, justifyContent: 'center' },
  footer: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 8 },
  emptyText: { color: colors.muted, marginTop: 4, textAlign: 'center' },
});
