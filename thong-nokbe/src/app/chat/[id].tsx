import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { limit, onSnapshot, orderBy, query } from '@react-native-firebase/firestore';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { messagesCol, sendMessage } from '../../lib/chats';
import { useCaller } from '../../components/useCaller';
import { useChatTitle } from '../../components/useChatTitle';
import { Avatar, Empty } from '../../components/ui';
import { dayKey, formatDayLong, formatTime } from '../../lib/dates';
import { colors } from '../../theme';
import type { Message } from '../../lib/types';
import { useBottomInset } from '../../components/useBottomInset';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const bottomInset = useBottomInset();
  const chat = useChat(id);
  const title = useChatTitle(chat, me.uid);
  const navigation = useNavigation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!id || !chat) return;
    const q = query(messagesCol(id), orderBy('createdAt', 'desc'), limit(300));
    return onSnapshot(q, (snap) => setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Message, 'id'>) }))), (e) => console.warn('messages', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!chat]);

  const { callChat } = useCaller();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => chat?.type === 'group' && router.push(`/group/${id}`)}>
          <Avatar name={title} size={34} />
          <View>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }} numberOfLines={1}>
              {title}
            </Text>
            {chat?.type === 'group' && <Text style={{ color: '#a7f3d0', fontSize: 12 }}>{chat.members.length} members · tap for info</Text>}
          </View>
        </Pressable>
      ),
      headerRight: () =>
        chat ? (
          <View style={{ flexDirection: 'row', gap: 18 }}>
            <Pressable onPress={() => callChat(chat, title, 'voice')} hitSlop={10} accessibilityLabel="Voice call">
              <Ionicons name="call" size={24} color="#fff" />
            </Pressable>
            <Pressable onPress={() => callChat(chat, title, 'video')} hitSlop={10} accessibilityLabel="Video call">
              <Ionicons name="videocam" size={26} color="#fff" />
            </Pressable>
            {chat.type === 'group' && (
              <Pressable onPress={() => router.push(`/group/${id}`)} hitSlop={10}>
                <Ionicons name="information-circle-outline" size={24} color="#fff" />
              </Pressable>
            )}
          </View>
        ) : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, chat, title, id]);

  if (!chat) return <Empty title="Chat unavailable" subtitle="You are not a member of this chat (you may have been removed)." />;

  const send = () => {
    const t = text;
    setText('');
    sendMessage(chat.id, me, t).catch((e) => {
      setText(t);
      Alert.alert('Message not sent', e?.message ?? String(e));
    });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.chatBg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        inverted
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 10 }}
        renderItem={({ item, index }) => {
          const older = messages[index + 1];
          const d = item.createdAt?.toDate() ?? new Date();
          const showDay = !older || dayKey(older.createdAt?.toDate() ?? new Date()) !== dayKey(d);
          return (
            <View>
              {showDay && (
                <View style={styles.dayChip}>
                  <Text style={styles.dayChipText}>{formatDayLong(d)}</Text>
                </View>
              )}
              <Bubble m={item} mine={item.senderId === me.uid} showName={chat.type === 'group'} />
            </View>
          );
        }}
      />
      <View style={[styles.composer, { paddingBottom: 8 + bottomInset }]}>
        <TextInput style={styles.input} placeholder="Message" value={text} onChangeText={setText} multiline placeholderTextColor={colors.muted} />
        <Pressable style={[styles.send, !text.trim() && { opacity: 0.5 }]} onPress={send} disabled={!text.trim()}>
          <Ionicons name="send" size={20} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ m, mine, showName }: { m: Message; mine: boolean; showName: boolean }) {
  if (m.type === 'system' || m.type === 'call') {
    return (
      <View style={[styles.dayChip, { backgroundColor: m.type === 'call' ? '#DCFCE7' : '#FFF7D6' }]}>
        <Text style={[styles.dayChipText, { color: colors.text }]}>{m.text}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.other]}>
      {showName && !mine && <Text style={styles.sender}>{m.senderName}</Text>}
      <Text style={styles.msg}>{m.text}</Text>
      <Text style={styles.time}>{m.createdAt ? formatTime(m.createdAt.toDate()) : '…'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4, marginVertical: 3 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.myBubble, borderTopRightRadius: 2 },
  other: { alignSelf: 'flex-start', backgroundColor: colors.otherBubble, borderTopLeftRadius: 2 },
  sender: { color: colors.primaryDark, fontWeight: '700', fontSize: 13, marginBottom: 2 },
  msg: { fontSize: 16, color: colors.text },
  time: { fontSize: 11, color: colors.muted, alignSelf: 'flex-end', marginTop: 2 },
  dayChip: { alignSelf: 'center', backgroundColor: '#E1F0FA', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginVertical: 8, maxWidth: '90%' },
  dayChipText: { fontSize: 12, color: '#334155', textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, gap: 8 },
  input: { flex: 1, backgroundColor: '#fff', borderRadius: 24, paddingHorizontal: 16, paddingVertical: Platform.OS === 'ios' ? 12 : 8, fontSize: 16, maxHeight: 120, color: colors.text },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
