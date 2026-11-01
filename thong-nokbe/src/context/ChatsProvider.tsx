import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from '@react-native-firebase/firestore';
import { db } from '../lib/firebase';
import { toChat } from '../lib/chats';
import type { Chat } from '../lib/types';
import { useAuth } from './AuthProvider';

interface ChatsState {
  chats: Chat[];
  groups: Chat[];
  loading: boolean;
  selectedGroupId: string | null;
  selectGroup: (id: string) => void;
  selectedGroup: Chat | null;
}

const Ctx = createContext<ChatsState | null>(null);

/** Live list of every chat the user belongs to + which gym group the Attendance/Fees tabs show. */
export function ChatsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'chats'), where('members', 'array-contains', user.uid), orderBy('updatedAt', 'desc'));
    return onSnapshot(
      q,
      (snap) => {
        setChats(snap.docs.map((d) => toChat(d.id, d.data())));
        setLoading(false);
      },
      (e) => {
        console.warn('chats listener', e);
        setLoading(false);
      },
    );
  }, [user]);

  const groups = useMemo(() => chats.filter((c) => c.type === 'group'), [chats]);
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? groups[0] ?? null;

  return (
    <Ctx.Provider value={{ chats, groups, loading, selectedGroupId: selectedGroup?.id ?? null, selectGroup: setSelected, selectedGroup }}>
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
