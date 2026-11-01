import { addDoc, arrayRemove, arrayUnion, collection, doc, getDoc, runTransaction, serverTimestamp, updateDoc } from '@react-native-firebase/firestore';
import { getIdToken } from '@react-native-firebase/auth';
import { auth, db } from './firebase';
import { CALL_SERVER_URL } from '../config';
import { getOrCreateDirectChat, sendMessage } from './chats';
import type { Call, CallKind, Chat, UserProfile } from './types';
import { APP_NAME } from '../theme';

export const RING_TIMEOUT_MS = 45_000;
export const callRef = (id: string) => doc(db, 'calls', id);

/** Only people who have the app (signed in, not logged out / uninstalled) can be called. */
export function hasApp(p: UserProfile | null | undefined) {
  return !!p && p.appInstalled !== false;
}

/** Stable 32-bit numeric id for a Firebase uid (Agora needs numeric uids). */
export function agoraUid(uid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

/** Rings everyone in a chat: the whole gym group, or the other person in a 1:1 chat. */
export async function startCall(chat: Chat, me: UserProfile, chatName: string, kind: CallKind) {
  const invited = chat.members.filter((m) => m !== me.uid);
  if (!invited.length) throw new Error('There is nobody else in this group to call yet.');
  const isGroup = chat.type === 'group';
  const ref = await addDoc(collection(db, 'calls'), {
    kind,
    chatId: chat.id,
    chatName,
    isGroup,
    callerId: me.uid,
    callerName: me.name,
    invited,
    ringingFor: invited,
    joined: [me.uid],
    declined: [],
    status: 'ringing',
    createdAt: serverTimestamp(),
  });
  const icon = kind === 'video' ? '📹' : '📞';
  sendMessage(chat.id, me, `${icon} ${me.name} started a ${isGroup ? 'group ' : ''}${kind} call`, 'call').catch(() => {});
  return ref.id;
}

/** Calls one app user directly (works for anyone on the app, not just gym-group members). */
export async function callPerson(me: UserProfile, other: UserProfile, kind: CallKind) {
  if (!hasApp(other)) throw new Error(`${other.name} doesn't have ${APP_NAME} right now, so they can't be called.`);
  const id = await getOrCreateDirectChat(me, other);
  const members = [me.uid, other.uid].sort();
  return startCall({ id, type: 'direct', members, admins: [], createdBy: me.uid, pendingPhones: [] }, me, other.name, kind);
}

export async function acceptCall(callId: string, me: UserProfile) {
  await updateDoc(callRef(callId), { joined: arrayUnion(me.uid), ringingFor: arrayRemove(me.uid), status: 'ongoing' });
}

export async function declineCall(callId: string, me: UserProfile) {
  await updateDoc(callRef(callId), { declined: arrayUnion(me.uid), ringingFor: arrayRemove(me.uid) });
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
        ? { status: 'ended', ringingFor: [], endedAt: serverTimestamp() }
        : {}),
    });
  });
}

export async function getCall(callId: string): Promise<Call | null> {
  const s = await getDoc(callRef(callId));
  return s.exists() ? ({ id: s.id, ...(s.data() as Omit<Call, 'id'>) } as Call) : null;
}

export interface CallPass {
  appId: string;
  token: string;
  uid: number;
}

/**
 * Asks the free call-pass server for this call's Agora pass. The server checks the person is signed in
 * and is part of the call (via the database rules) before handing it out; the Agora secret stays there.
 */
export async function getCallPass(callId: string): Promise<CallPass> {
  if (!CALL_SERVER_URL) throw new Error('Calling is not set up yet (call-pass server address missing). See SETUP-GUIDE Part B.');
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again.');
  const idToken = await getIdToken(user);
  let res: Response;
  try {
    res = await fetch(CALL_SERVER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ channel: callId }),
    });
  } catch {
    throw new Error('No internet connection. Check mobile data or Wi-Fi and try again.');
  }
  const body = (await res.json().catch(() => ({}))) as Partial<CallPass> & { error?: string };
  if (!res.ok || !body.token || !body.appId || !body.uid) {
    if (res.status === 410) throw new Error('This call has already ended.');
    if (res.status === 403) throw new Error("You're not part of this call.");
    throw new Error(body.error ?? `Call server error (${res.status}).`);
  }
  return body as CallPass;
}
