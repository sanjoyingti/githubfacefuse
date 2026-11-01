/**
 * Thong Nokbe backend:
 *  - push notifications for new chat messages and incoming video calls
 *  - Agora RTC tokens for calls (only members of the call can get one)
 *  - monthly fee reminders on the 1st (and a follow-up for unpaid members on the 5th)
 *  - auto-join: when a new user signs up, add them to groups that invited their number
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { RtcRole, RtcTokenBuilder } from 'agora-token';

initializeApp();
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });
const db = getFirestore();

const AGORA_APP_ID = defineString('AGORA_APP_ID');
const AGORA_APP_CERTIFICATE = defineSecret('AGORA_APP_CERTIFICATE');

async function tokensFor(uids: string[]): Promise<{ tokens: string[]; owner: Map<string, string> }> {
  const owner = new Map<string, string>();
  if (!uids.length) return { tokens: [], owner };
  const refs = uids.map((u) => db.collection('users').doc(u));
  const snaps = await db.getAll(...refs);
  for (const s of snaps) for (const t of (s.get('pushTokens') as string[] | undefined) ?? []) owner.set(t, s.id);
  return { tokens: [...owner.keys()], owner };
}

/** Sends to many devices in chunks and removes tokens FCM says are dead. */
async function send(uids: string[], build: (tokens: string[]) => MulticastMessage) {
  const { tokens, owner } = await tokensFor(uids);
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const res = await getMessaging().sendEachForMulticast(build(chunk));
    await Promise.all(
      res.responses.map((r, idx) => {
        const code = r.error?.code ?? '';
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          const uid = owner.get(chunk[idx]);
          if (uid) return db.collection('users').doc(uid).update({ pushTokens: FieldValue.arrayRemove(chunk[idx]) });
        }
        return null;
      }),
    );
  }
}

export const onNewMessage = onDocumentCreated('chats/{chatId}/messages/{msgId}', async (event) => {
  const msg = event.data?.data();
  if (!msg || msg.type === 'call') return; // calls have their own notification
  const chatSnap = await db.collection('chats').doc(event.params.chatId).get();
  const chat = chatSnap.data();
  if (!chat) return;
  const recipients = (chat.members as string[]).filter((u) => u !== msg.senderId);
  const title = chat.type === 'group' ? chat.name : msg.senderName;
  const body = chat.type === 'group' && msg.type !== 'system' ? `${msg.senderName}: ${msg.text}` : msg.text;
  await send(recipients, (tokens) => ({
    tokens,
    notification: { title, body: String(body).slice(0, 200) },
    data: { kind: 'message', chatId: event.params.chatId },
    android: { priority: 'high', notification: { tag: event.params.chatId } },
    apns: { payload: { aps: { sound: 'default', threadId: event.params.chatId } } },
  }));
});

export const onNewCall = onDocumentCreated('calls/{callId}', async (event) => {
  const call = event.data?.data();
  if (!call) return;
  const title = call.isGroup ? `📹 ${call.chatName}` : `📹 ${call.callerName}`;
  const body = call.isGroup ? `${call.callerName} started a group video call` : 'Incoming video call';
  await send(call.invited as string[], (tokens) => ({
    tokens,
    notification: { title, body },
    data: { kind: 'call', callId: event.params.callId, chatId: String(call.chatId) },
    android: { priority: 'high', ttl: 45_000, notification: { sound: 'default' } },
    apns: { headers: { 'apns-priority': '10', 'apns-expiration': String(Math.floor(Date.now() / 1000) + 45) }, payload: { aps: { sound: 'default' } } },
  }));
});

/** Returns an Agora token for the caller, only if they are part of the call. Returns '' if no certificate is configured. */
export const agoraToken = onCall({ secrets: [AGORA_APP_CERTIFICATE] }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first');
  const { channel, uid } = req.data as { channel: string; uid: number };
  if (!channel || typeof uid !== 'number') throw new HttpsError('invalid-argument', 'channel and uid are required');
  const call = (await db.collection('calls').doc(channel).get()).data();
  if (!call || (call.callerId !== req.auth.uid && !(call.invited as string[]).includes(req.auth.uid))) {
    throw new HttpsError('permission-denied', 'You are not part of this call');
  }
  const cert = AGORA_APP_CERTIFICATE.value();
  if (!cert) return { token: '' };
  const token = RtcTokenBuilder.buildTokenWithUid(AGORA_APP_ID.value(), cert, channel, uid, RtcRole.PUBLISHER, 3600, 3600);
  return { token };
});

function monthKeyIST(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 1st of every month, 8:00 IST: tell every gym group member their fee is due. */
export const feeDueReminder = onSchedule({ schedule: '0 8 1 * *', timeZone: 'Asia/Kolkata' }, async () => {
  const groups = await db.collection('chats').where('type', '==', 'group').get();
  for (const g of groups.docs) {
    const upi = g.get('upi');
    if (!upi?.amount) continue;
    await send(g.get('members') as string[], (tokens) => ({
      tokens,
      notification: { title: `${g.get('name')}: gym fee due today`, body: `₹${upi.amount} for this month. Tap to pay from the Fees tab.` },
      data: { kind: 'fees', chatId: g.id },
    }));
  }
});

/** 5th of every month: remind only those who still haven't paid. */
export const feeOverdueReminder = onSchedule({ schedule: '0 18 5 * *', timeZone: 'Asia/Kolkata' }, async () => {
  const month = monthKeyIST();
  const groups = await db.collection('chats').where('type', '==', 'group').get();
  for (const g of groups.docs) {
    const upi = g.get('upi');
    if (!upi?.amount) continue;
    const paid = new Set((await g.ref.collection('fees').doc(month).collection('payments').get()).docs.map((d) => d.id));
    const unpaid = (g.get('members') as string[]).filter((u) => !paid.has(u));
    await send(unpaid, (tokens) => ({
      tokens,
      notification: { title: `${g.get('name')}: fee overdue`, body: `Your ₹${upi.amount} gym fee for this month is still unpaid.` },
      data: { kind: 'fees', chatId: g.id },
    }));
  }
});

/** Server-side backup for auto-join (the app also does this on sign in). */
export const onUserCreated = onDocumentCreated('users/{uid}', async (event) => {
  const phone = event.data?.get('phone') as string | undefined;
  if (!phone) return;
  const invited = await db.collection('chats').where('pendingPhones', 'array-contains', phone).get();
  await Promise.all(
    invited.docs.map((d) =>
      d.ref.update({ members: FieldValue.arrayUnion(event.params.uid), pendingPhones: FieldValue.arrayRemove(phone) }),
    ),
  );
});
