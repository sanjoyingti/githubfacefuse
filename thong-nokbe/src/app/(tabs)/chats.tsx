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
  const { chats, loading } = useChats();
  if (loading) return <Loading />;
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
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
        <Pressable style={[styles.fab, styles.fabSmall]} onPress={() => router.push('/new-chat')}>
          <Ionicons name="chatbubble-ellipses" size={22} color={colors.primary} />
        </Pressable>
        <Pressable style={styles.fab} onPress={() => router.push('/new-group')}>
          <Ionicons name="people" size={26} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  middle: { flex: 1, marginLeft: 14 },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1, marginRight: 8 },
  time: { fontSize: 12, color: colors.muted },
  preview: { color: colors.muted, marginTop: 3, flex: 1 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 80 },
  fabs: { position: 'absolute', right: 18, bottom: 24, alignItems: 'center', gap: 14 },
  fab: { width: 58, height: 58, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  fabSmall: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#fff' },
});
