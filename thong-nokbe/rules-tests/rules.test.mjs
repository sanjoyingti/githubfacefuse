// Security-rule tests against the Firestore emulator. Run: npm test (inside rules-tests/)
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { arrayRemove, arrayUnion, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, deleteDoc } from 'firebase/firestore';

let env;
const ADMIN = { uid: 'admin', phone: '+919000000001' };
const MEMBER = { uid: 'member', phone: '+919000000002' };
const OUTSIDER = { uid: 'outsider', phone: '+919000000003' };
const INVITEE = { uid: 'invitee', phone: '+919000000004' };
const as = (u) => env.authenticatedContext(u.uid, { phone_number: u.phone }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-thong-nokbe',
    firestore: { rules: readFileSync('../firestore.rules', 'utf8') },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'chats/g1'), {
      type: 'group', name: 'Gym', members: [ADMIN.uid, MEMBER.uid], admins: [ADMIN.uid], createdBy: ADMIN.uid,
      pendingPhones: [INVITEE.phone], upi: null, updatedAt: new Date(),
    });
  });
});

test('users: can only create own profile with own verified phone', async () => {
  await assertSucceeds(setDoc(doc(as(MEMBER), 'users/member'), { name: 'M', phone: MEMBER.phone }));
  await assertFails(setDoc(doc(as(MEMBER), 'users/member'), { name: 'M', phone: '+911111111111' }));
  await assertFails(setDoc(doc(as(MEMBER), 'users/admin'), { name: 'X', phone: MEMBER.phone }));
});

test('groups: creator must be sole admin', async () => {
  await assertSucceeds(setDoc(doc(as(MEMBER), 'chats/g2'), { type: 'group', name: 'G', members: ['member', 'x'], admins: ['member'], createdBy: 'member', pendingPhones: [] }));
  await assertFails(setDoc(doc(as(MEMBER), 'chats/g3'), { type: 'group', name: 'G', members: ['member', 'x'], admins: ['member', 'x'], createdBy: 'member', pendingPhones: [] }));
});

test('groups: only admins add/remove members or appoint admins', async () => {
  await assertFails(updateDoc(doc(as(MEMBER), 'chats/g1'), { members: arrayUnion('someone') }));
  await assertFails(updateDoc(doc(as(MEMBER), 'chats/g1'), { admins: arrayUnion(MEMBER.uid) }));
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'chats/g1'), { members: arrayUnion('someone') }));
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'chats/g1'), { admins: arrayUnion(MEMBER.uid) }));
});

test('groups: member can leave, outsider cannot read', async () => {
  await assertFails(getDoc(doc(as(OUTSIDER), 'chats/g1')));
  await assertSucceeds(updateDoc(doc(as(MEMBER), 'chats/g1'), { members: arrayRemove(MEMBER.uid), admins: arrayRemove(MEMBER.uid) }));
});

test('invites: invited phone can find and join the group, nobody else can', async () => {
  const q = query(collection(as(INVITEE), 'chats'), where('pendingPhones', 'array-contains', INVITEE.phone));
  const snap = await assertSucceeds(getDocs(q));
  if (snap.size !== 1) throw new Error('invitee should see 1 group');
  await assertFails(updateDoc(doc(as(OUTSIDER), 'chats/g1'), { members: arrayUnion(OUTSIDER.uid), pendingPhones: arrayRemove(INVITEE.phone) }));
  await assertSucceeds(updateDoc(doc(as(INVITEE), 'chats/g1'), { members: arrayUnion(INVITEE.uid), pendingPhones: arrayRemove(INVITEE.phone) }));
});

test('messages: members only, as themselves', async () => {
  await assertSucceeds(setDoc(doc(as(MEMBER), 'chats/g1/messages/m1'), { senderId: MEMBER.uid, senderName: 'M', text: 'hi', type: 'text', createdAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as(MEMBER), 'chats/g1'), { lastMessage: { text: 'hi' }, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as(MEMBER), 'chats/g1/messages/m2'), { senderId: ADMIN.uid, senderName: 'A', text: 'spoof', type: 'text' }));
  await assertFails(setDoc(doc(as(OUTSIDER), 'chats/g1/messages/m3'), { senderId: OUTSIDER.uid, senderName: 'O', text: 'hi', type: 'text' }));
});

test('attendance: only admin marks, members view', async () => {
  const rec = { date: '2026-11-02', month: '2026-11', records: { member: 'present' }, markedBy: 'x' };
  await assertFails(setDoc(doc(as(MEMBER), 'chats/g1/attendance/2026-11-02'), rec));
  await assertSucceeds(setDoc(doc(as(ADMIN), 'chats/g1/attendance/2026-11-02'), rec));
  await assertSucceeds(getDocs(query(collection(as(MEMBER), 'chats/g1/attendance'), where('month', '==', '2026-11'))));
  await assertFails(getDocs(collection(as(OUTSIDER), 'chats/g1/attendance')));
});

test('fees: member records own UPI payment only; admin can mark cash or undo', async () => {
  const p = (uid, method) => ({ month: '2026-11', status: 'paid', amount: 800, method, txnId: 'T1', recordedBy: uid, paidAt: serverTimestamp() });
  await assertSucceeds(setDoc(doc(as(MEMBER), 'chats/g1/fees/2026-11/payments/member'), p('member', 'upi')));
  await assertFails(setDoc(doc(as(MEMBER), 'chats/g1/fees/2026-11/payments/admin'), p('member', 'upi')));
  await assertFails(setDoc(doc(as(MEMBER), 'chats/g1/fees/2026-11/payments/member'), p('member', 'cash')));
  await assertFails(deleteDoc(doc(as(MEMBER), 'chats/g1/fees/2026-11/payments/member')));
  await assertSucceeds(setDoc(doc(as(ADMIN), 'chats/g1/fees/2026-11/payments/member'), p('admin', 'cash')));
  await assertSucceeds(deleteDoc(doc(as(ADMIN), 'chats/g1/fees/2026-11/payments/member')));
  await assertSucceeds(getDocs(collection(as(MEMBER), 'chats/g1/fees/2026-11/payments')));
});

test('calls: member can ring the group; invitees see and answer it', async () => {
  const c = { kind: 'video', chatId: 'g1', chatName: 'Gym', isGroup: true, callerId: ADMIN.uid, callerName: 'A', invited: [MEMBER.uid], joined: [ADMIN.uid], declined: [], status: 'ringing', createdAt: serverTimestamp() };
  await assertFails(setDoc(doc(as(OUTSIDER), 'calls/c1'), { ...c, callerId: OUTSIDER.uid }));
  await assertSucceeds(setDoc(doc(as(ADMIN), 'calls/c1'), c));
  const q = query(collection(as(MEMBER), 'calls'), where('invited', 'array-contains', MEMBER.uid), where('status', 'in', ['ringing', 'ongoing']));
  await assertSucceeds(getDocs(q));
  await assertSucceeds(updateDoc(doc(as(MEMBER), 'calls/c1'), { joined: arrayUnion(MEMBER.uid), status: 'ongoing' }));
  await assertFails(getDoc(doc(as(OUTSIDER), 'calls/c1')));
});

test('direct chats: 1:1 id must match both members', async () => {
  await assertSucceeds(getDoc(doc(as(MEMBER), 'chats/dm_admin_member'))); // doesn't exist yet
  await assertSucceeds(setDoc(doc(as(MEMBER), 'chats/dm_admin_member'), { type: 'direct', members: ['admin', 'member'], admins: [], createdBy: 'member', pendingPhones: [] }));
  await assertFails(setDoc(doc(as(OUTSIDER), 'chats/dm_admin_member2'), { type: 'direct', members: ['admin', 'member'], admins: [], createdBy: 'outsider', pendingPhones: [] }));
});

test('calls: can only ring people in the same chat, as voice or video', async () => {
  const c = { kind: 'voice', chatId: 'g1', chatName: 'Gym', isGroup: true, callerId: MEMBER.uid, callerName: 'M', invited: [ADMIN.uid], joined: [MEMBER.uid], declined: [], status: 'ringing' };
  await assertSucceeds(setDoc(doc(as(MEMBER), 'calls/v1'), c));
  // someone who is not in the group
  await assertFails(setDoc(doc(as(MEMBER), 'calls/v2'), { ...c, invited: [ADMIN.uid, OUTSIDER.uid] }));
  // must be voice or video
  await assertFails(setDoc(doc(as(MEMBER), 'calls/v3'), { ...c, kind: 'phone' }));
  // nobody to ring / ringing yourself
  await assertFails(setDoc(doc(as(MEMBER), 'calls/v4'), { ...c, invited: [] }));
  await assertFails(setDoc(doc(as(MEMBER), 'calls/v5'), { ...c, invited: [MEMBER.uid] }));
});

test('calls: any app user can call any other app user 1:1', async () => {
  // OUTSIDER shares no group with INVITEE, but can open a 1:1 chat and call them.
  await assertSucceeds(setDoc(doc(as(OUTSIDER), 'chats/dm_invitee_outsider'), { type: 'direct', members: ['invitee', 'outsider'], admins: [], createdBy: 'outsider', pendingPhones: [] }));
  const c = { kind: 'video', chatId: 'dm_invitee_outsider', chatName: 'I', isGroup: false, callerId: OUTSIDER.uid, callerName: 'O', invited: [INVITEE.uid], joined: [OUTSIDER.uid], declined: [], status: 'ringing' };
  await assertSucceeds(setDoc(doc(as(OUTSIDER), 'calls/d1'), c));
  await assertSucceeds(updateDoc(doc(as(INVITEE), 'calls/d1'), { joined: arrayUnion(INVITEE.uid), status: 'ongoing' }));
  // a third person can't see or join it
  await assertFails(getDoc(doc(as(MEMBER), 'calls/d1')));
  await assertFails(updateDoc(doc(as(MEMBER), 'calls/d1'), { joined: arrayUnion(MEMBER.uid) }));
});

test('users: can mark own app as installed/uninstalled only', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users/member'), { name: 'M', phone: MEMBER.phone, appInstalled: true }));
  await assertSucceeds(updateDoc(doc(as(MEMBER), 'users/member'), { appInstalled: false }));
  await assertFails(updateDoc(doc(as(ADMIN), 'users/member'), { appInstalled: true }));
});
