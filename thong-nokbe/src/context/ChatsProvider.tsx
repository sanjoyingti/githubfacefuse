import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from '@react-native-firebase/firestore';
import { db } from '../lib/firebase';
import { toChat } from '../lib/chats';
import { notifyIfAway, scheduleFeeReminder } from '../lib/localNotify';
import type { Chat } from '../lib/types';
import { useAuth } from './AuthProvider';

interface ChatsState {
  chats: Chat[];
  groups: Chat[];
  loading: boolean;
  selectedGroupId: string | null;
  selectGroup: (id: string) => void;
  selectedGroup: Chat | null;
  /** Groups I asked to join (my number was invited) that an admin hasn't approved yet. */
  waitingGroups: Chat[];
}

const Ctx = createContext<ChatsState | null>(null);

/** Live list of every chat the user belongs to + which gym group the Attendance/Fees tabs show. */
export function ChatsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelected] = useState<string | null>(null);
  const [waitingGroups, setWaiting] = useState<Chat[]>([]);
  const lastSeen = useRef<Record<string, number> | null>(null);

  useEffect(() => {
    if (!user) return;
    // Sorted on the phone (newest first) so the database needs no extra index setup.
    const q = query(collection(db, 'chats'), where('members', 'array-contains', user.uid));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => toChat(d.id, d.data()))
          .sort((a, b) => (b.updatedAt?.toMillis?.() ?? Date.now()) - (a.updatedAt?.toMillis?.() ?? Date.now()));
        // Phone notification for new messages from others while the app is in the background.
        const prev = lastSeen.current;
        const next: Record<string, number> = {};
        for (const c of list) {
          const at = c.lastMessage?.at?.toMillis?.() ?? 0;
          next[c.id] = at;
          if (prev && at > (prev[c.id] ?? 0) && c.lastMessage && c.lastMessage.senderId !== user.uid) {
            const title = c.type === 'group' ? c.name ?? 'Group' : c.lastMessage.senderName;
            const body = c.type === 'group' ? `${c.lastMessage.senderName}: ${c.lastMessage.text}` : c.lastMessage.text;
            notifyIfAway(title, body, { kind: 'message', chatId: c.id });
          }
        }
        lastSeen.current = next;
        setChats(list);
        setLoading(false);
      },
      (e) => {
        console.warn('chats listener', e);
        setLoading(false);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collection(db, 'chats'), where('joinRequests', 'array-contains', user.uid)),
      (snap) => setWaiting(snap.docs.map((d) => toChat(d.id, d.data()))),
      () => {},
    );
  }, [user]);

  const groups = useMemo(() => chats.filter((c) => c.type === 'group'), [chats]);

  // Monthly "fee due" alarm on this phone (1st of the month, 9 AM).
  const feeAmount = groups.find((g) => g.upi?.amount)?.upi?.amount;
  useEffect(() => {
    if (groups.length) scheduleFeeReminder(feeAmount);
  }, [groups.length, feeAmount]);
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? groups[0] ?? null;

  return (
    <Ctx.Provider value={{ chats, groups, loading, selectedGroupId: selectedGroup?.id ?? null, selectGroup: setSelected, selectedGroup, waitingGroups }}>
      {children}
    </Ctx.Provider>
  );
}

export function useChats() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChats must be used inside ChatsProvider');
  return v;
}

export function useChat(id: string | undefined) {
  const { chats } = useChats();
  return chats.find((c) => c.id === id) ?? null;
}
