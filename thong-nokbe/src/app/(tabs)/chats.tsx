import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useChats } from '../../context/ChatsProvider';
import { useMe } from '../../context/AuthProvider';
import { useChatTitle } from '../../components/useChatTitle';
import { formatChatTimestamp } from '../../lib/dates';
import { Avatar, Button, Empty, Loading } from '../../components/ui';
import { colors } from '../../theme';
import type { Chat } from '../../lib/types';

function ChatRow({ chat, meUid }: { chat: Chat; meUid: string }) {
  const title = useChatTitle(chat, meUid);
  const last = chat.lastMessage;
  const prefix = last && chat.type === 'group' && last.senderId !== meUid && !last.text.startsWith('📹') ? `${last.senderName}: ` : last?.senderId === meUid ? 'You: ' : '';
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/chat/${chat.id}`)}>
      <Avatar name={title} size={50} />
      <View style={styles.middle}>
        <View style={styles.topLine}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {last?.at ? <Text style={styles.time}>{formatChatTimestamp(last.at.toDate())}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {chat.type === 'group' && chat.admins.includes(meUid) && <Ionicons name="shield-checkmark" size={13} color={colors.primary} />}
          <Text style={styles.preview} numberOfLines={1}>
            {last ? prefix + last.text : chat.type === 'group' ? `${chat.members.length} members` : 'Say hi 👋'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function Chats() {
  const me = useMe();
  const { chats, loading, waitingGroups } = useChats();
  if (loading) return <Loading />;
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {waitingGroups.map((g) => (
        <View key={g.id} style={styles.waiting}>
          <Text style={{ fontSize: 22 }}>⏳</Text>
          <Text style={styles.waitingText}>
            You asked to join <Text style={{ fontWeight: '900' }}>{g.name}</Text>. Waiting for the group admin to approve.
          </Text>
        </View>
      ))}
      <FlatList
        data={chats}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <ChatRow chat={item} meUid={me.uid} />}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <Empty title="No chats yet" subtitle="Create a group for your gym and add members from your contacts or by phone number.">
            <Button title="Create gym group" onPress={() => router.push('/new-group')} />
          </Empty>
        }
        contentContainerStyle={{ paddingBottom: 120 }}
      />
      <View style={styles.fabs}>
        <Pressable style={[styles.fab, styles.fabLight]} onPress={() => router.push('/new-chat')}>
          <Ionicons name="person-add" size={22} color={colors.primary} />
          <Text style={[styles.fabText, { color: colors.primary }]}>New chat</Text>
        </Pressable>
        <Pressable style={styles.fab} onPress={() => router.push('/new-group')}>
          <Ionicons name="people" size={24} color="#fff" />
          <Text style={styles.fabText}>New group</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  middle: { flex: 1, marginLeft: 14 },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text, flex: 1, marginRight: 8 },
  time: { fontSize: 12, color: colors.muted },
  preview: { color: colors.muted, marginTop: 3, flex: 1, fontSize: 15 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FEF3C7', margin: 10, marginBottom: 0, padding: 12, borderRadius: 14 },
  waitingText: { flex: 1, color: '#92400E', fontSize: 15 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 80 },
  fabs: { position: 'absolute', right: 16, bottom: 20, alignItems: 'flex-end', gap: 12 },
  fab: { flexDirection: 'row', gap: 8, height: 56, paddingHorizontal: 20, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  fabLight: { backgroundColor: '#fff', borderWidth: 2, borderColor: colors.primary },
  fabText: { color: '#fff', fontWeight: '900', fontSize: 16 },
});
