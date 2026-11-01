import { arrayUnion, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from '@react-native-firebase/firestore';
import { db } from './firebase';
import { chatRef, sendMessage } from './chats';
import { CALL_SERVER_URL } from '../config';
import type { Chat, UserProfile } from './types';

/**
 * WhatsApp-style group invite links. The admin shares a link; anyone with the app who opens it can join.
 * invites/{code} holds { chatId, name } so the join screen can show the group's name; the group doc keeps
 * inviteCode, which the security rules check when someone joins.
 */
const inviteRef = (code: string) => doc(db, 'invites', code);

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function inviteLink(code: string) {
  return `${CALL_SERVER_URL}/join/${code}`;
}

/** Returns the group's invite code, creating one the first time (admins only). */
export async function ensureInviteCode(chat: Chat, admin: UserProfile): Promise<string> {
  if (chat.inviteCode) return chat.inviteCode;
  return resetInviteCode(chat, admin);
}

/** Makes a new link; the old link stops working (admins only). */
export async function resetInviteCode(chat: Chat, admin: UserProfile): Promise<string> {
  const code = newCode();
  const batch = writeBatch(db);
  batch.set(inviteRef(code), { chatId: chat.id, name: chat.name ?? 'Gym group', createdBy: admin.uid, createdAt: serverTimestamp() });
  batch.update(chatRef(chat.id), { inviteCode: code });
  await batch.commit();
  if (chat.inviteCode) await deleteDoc(inviteRef(chat.inviteCode)).catch(() => {});
  return code;
}

export async function getInvite(code: string): Promise<{ chatId: string; name: string } | null> {
  const s = await getDoc(inviteRef(code));
  return s.exists() ? (s.data() as { chatId: string; name: string }) : null;
}

/** Joins the group behind an invite link. Returns the group's chat id. */
export async function joinWithCode(code: string, me: UserProfile): Promise<string> {
  const invite = await getInvite(code);
  if (!invite) throw new Error('This invite link has expired or was reset by the group admin. Ask them for a new link.');
  await updateDoc(chatRef(invite.chatId), { members: arrayUnion(me.uid), lastJoinCode: code });
  await sendMessage(invite.chatId, me, `${me.name} joined using the invite link`, 'system');
  return invite.chatId;
}

/** Keeps the name shown on the join screen up to date after the group is renamed. */
export async function syncInviteName(chat: Chat) {
  if (chat.inviteCode) await setDoc(inviteRef(chat.inviteCode), { name: chat.name ?? 'Gym group' }, { merge: true }).catch(() => {});
}
