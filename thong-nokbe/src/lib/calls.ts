import { addDoc, arrayRemove, arrayUnion, collection, doc, getDoc, runTransaction, serverTimestamp, updateDoc } from '@react-native-firebase/firestore';
import { httpsCallable } from '@react-native-firebase/functions';
import { db, functions } from './firebase';
import { sendMessage } from './chats';
import type { Call, Chat, UserProfile } from './types';

export const RING_TIMEOUT_MS = 45_000;
export const callRef = (id: string) => doc(db, 'calls', id);

/** Stable 32-bit numeric id for a Firebase uid (Agora needs numeric uids). */
export function agoraUid(uid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483646 + 1;
}

export async function startCall(chat: Chat, me: UserProfile, chatName: string, onlyUid?: string) {
  const invited = (onlyUid ? [onlyUid] : chat.members).filter((m) => m !== me.uid);
  const ref = await addDoc(collection(db, 'calls'), {
    chatId: chat.id,
    chatName,
    isGroup: chat.type === 'group' && !onlyUid,
    callerId: me.uid,
    callerName: me.name,
    invited,
    joined: [me.uid],
    declined: [],
    status: 'ringing',
    createdAt: serverTimestamp(),
  });
  sendMessage(chat.id, me, `📹 ${me.name} started a ${onlyUid || chat.type === 'direct' ? '' : 'group '}video call`, 'call').catch(() => {});
  return ref.id;
}

export async function acceptCall(callId: string, me: UserProfile) {
  await updateDoc(callRef(callId), { joined: arrayUnion(me.uid), status: 'ongoing' });
}

export async function declineCall(callId: string, me: UserProfile) {
  await updateDoc(callRef(callId), { declined: arrayUnion(me.uid) });
}

/** Leaves the call; the call is marked ended once nobody is left in it. */
export async function leaveCall(callId: string, me: UserProfile) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(callRef(callId));
    if (!snap.exists()) return;
    const c = snap.data() as Call;
    const joined = (c.joined ?? []).filter((u) => u !== me.uid);
    tx.update(callRef(callId), {
      joined: arrayRemove(me.uid),
      ...(joined.length === 0 || !c.isGroup || (c.status === 'ringing' && c.callerId === me.uid)
        ? { status: 'ended', endedAt: serverTimestamp() }
        : {}),
    });
  });
}

export async function getCall(callId: string): Promise<Call | null> {
  const s = await getDoc(callRef(callId));
  return s.exists() ? ({ id: s.id, ...(s.data() as Omit<Call, 'id'>) } as Call) : null;
}

/** Fetches an Agora token from the Cloud Function. Returns '' when the project runs Agora in "testing mode" (App ID only). */
export async function getAgoraToken(channel: string, uid: number): Promise<string> {
  try {
    const fn = httpsCallable<{ channel: string; uid: number }, { token: string }>(functions, 'agoraToken');
    const res = await fn({ channel, uid });
    return res.data.token ?? '';
  } catch (e) {
    console.warn('agoraToken function unavailable, joining without token', e);
    return '';
  }
}
