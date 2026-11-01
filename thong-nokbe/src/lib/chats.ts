import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@react-native-firebase/firestore';
import { db } from './firebase';
import type { Chat, UserProfile } from './types';

export const chatRef = (id: string) => doc(db, 'chats', id);
export const messagesCol = (chatId: string) => collection(db, 'chats', chatId, 'messages');

function msgPayload(me: UserProfile, text: string, type: 'text' | 'system' | 'call' = 'text') {
  return { senderId: me.uid, senderName: me.name, text, type, createdAt: serverTimestamp() };
}

export async function sendMessage(chatId: string, me: UserProfile, text: string, type: 'text' | 'system' | 'call' = 'text') {
  const t = text.trim();
  if (!t) return;
  const batch = writeBatch(db);
  batch.set(doc(messagesCol(chatId)), msgPayload(me, t, type));
  batch.update(chatRef(chatId), {
    lastMessage: { text: t, senderId: me.uid, senderName: me.name, at: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function createGroup(me: UserProfile, name: string, memberUids: string[], pendingPhones: string[]) {
  const members = [...new Set([me.uid, ...memberUids])];
  const ref = await addDoc(collection(db, 'chats'), {
    type: 'group',
    name: name.trim(),
    description: '',
    members,
    admins: [me.uid],
    createdBy: me.uid,
    pendingPhones: [...new Set(pendingPhones)],
    upi: null,
    lastMessage: { text: `${me.name} created group "${name.trim()}"`, senderId: me.uid, senderName: me.name, at: serverTimestamp() },
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  await addDoc(messagesCol(ref.id), msgPayload(me, `${me.name} created group "${name.trim()}"`, 'system'));
  return ref.id;
}

export async function addMembers(chat: Chat, me: UserProfile, users: UserProfile[], phones: string[]) {
  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (users.length) updates.members = arrayUnion(...users.map((u) => u.uid));
  if (phones.length) updates.pendingPhones = arrayUnion(...phones);
  await updateDoc(chatRef(chat.id), updates);
  const names = [...users.map((u) => u.name), ...phones];
  if (names.length) await sendMessage(chat.id, me, `${me.name} added ${names.join(', ')}`, 'system');
}

export async function removeMember(chat: Chat, me: UserProfile, target: UserProfile) {
  await updateDoc(chatRef(chat.id), { members: arrayRemove(target.uid), admins: arrayRemove(target.uid) });
  await sendMessage(chat.id, me, `${me.name} removed ${target.name}`, 'system');
}

export async function cancelInvite(chat: Chat, phone: string) {
  await updateDoc(chatRef(chat.id), { pendingPhones: arrayRemove(phone) });
}

export async function makeAdmin(chat: Chat, me: UserProfile, target: UserProfile) {
  await updateDoc(chatRef(chat.id), { admins: arrayUnion(target.uid) });
  await sendMessage(chat.id, me, `${me.name} made ${target.name} a group admin`, 'system');
}

export async function dismissAdmin(chat: Chat, me: UserProfile, target: UserProfile) {
  await updateDoc(chatRef(chat.id), { admins: arrayRemove(target.uid) });
  await sendMessage(chat.id, me, `${target.name} is no longer an admin`, 'system');
}

export async function leaveGroup(chat: Chat, me: UserProfile) {
  await sendMessage(chat.id, me, `${me.name} left`, 'system');
  const remaining = chat.members.filter((m) => m !== me.uid);
  const remainingAdmins = chat.admins.filter((a) => a !== me.uid);
  if (remainingAdmins.length === 0 && remaining.length > 0) {
    // Like WhatsApp: if the last admin leaves, another member becomes admin.
    await updateDoc(chatRef(chat.id), { admins: [remaining[0]], members: arrayRemove(me.uid) });
  } else {
    await updateDoc(chatRef(chat.id), { members: arrayRemove(me.uid), admins: arrayRemove(me.uid) });
  }
}

export async function updateGroupInfo(chatId: string, data: { name?: string; description?: string }) {
  await updateDoc(chatRef(chatId), data);
}

export function directChatId(a: string, b: string) {
  return 'dm_' + [a, b].sort().join('_');
}

export async function getOrCreateDirectChat(me: UserProfile, other: UserProfile) {
  const id = directChatId(me.uid, other.uid);
  const ref = chatRef(id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      type: 'direct',
      members: [me.uid, other.uid].sort(),
      admins: [],
      createdBy: me.uid,
      pendingPhones: [],
      lastMessage: null,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  }
  return id;
}

/** When someone installs the app, join every group that invited their phone number. */
export async function joinPendingGroups(me: UserProfile) {
  const snap = await getDocs(query(collection(db, 'chats'), where('pendingPhones', 'array-contains', me.phone)));
  for (const d of snap.docs) {
    await updateDoc(d.ref, { members: arrayUnion(me.uid), pendingPhones: arrayRemove(me.phone) });
    await sendMessage(d.id, me, `${me.name} joined using the invite`, 'system');
  }
  return snap.size;
}

export function toChat(id: string, data: any): Chat {
  return { id, members: [], admins: [], pendingPhones: [], ...data } as Chat;
}
