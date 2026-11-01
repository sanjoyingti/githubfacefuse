// Security-rule tests against the Firestore emulator. Run: npm test (inside rules-tests/)
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { arrayRemove, arrayUnion, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, deleteDoc, writeBatch } from 'firebase/firestore';

let env;
const ADMIN = { uid: 'admin', phone: '+919000000001' };
const MEMBER = { uid: 'member', phone: '+919000000002' };
const OUTSIDER = { uid: 'outsider', phone: '+919000000003' };
const INVITEE = { uid: 'invitee', phone: '+919000000004' };
const as = (u) => env.authenticatedContext(u.uid, { email: `${u.uid}@gmail.com` }).firestore(); // Google sign-in: no phone in the token

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
    for (const u of [ADMIN, MEMBER, OUTSIDER, INVITEE]) {
      await setDoc(doc(db, 'users', u.uid), { name: u.uid, phone: u.phone, appInstalled: true });
      await setDoc(doc(db, 'phoneIndex', u.phone), { uid: u.uid });
    }
    await setDoc(doc(db, 'chats/g1'), {
      type: 'group', name: 'Gym', members: [ADMIN.uid, MEMBER.uid], admins: [ADMIN.uid], createdBy: ADMIN.uid,
      pendingPhones: [INVITEE.phone], upi: null, updatedAt: new Date(),
    });
  });
});

test('register: claim a free phone number once; taken numbers and other profiles are refused', async () => {
  const NEW = { uid: 'newbie', phone: '+919000000009' };
  const db = as(NEW);
  // profile without claiming the number
  await assertFails(setDoc(doc(db, 'users/newbie'), { name: 'N', phone: NEW.phone }));
  // someone else's number (already in phoneIndex)
  const b1 = writeBatch(db);
  b1.set(doc(db, 'phoneIndex', MEMBER.phone), { uid: NEW.uid });
  b1.set(doc(db, 'users/newbie'), { name: 'N', phone: MEMBER.phone });
  await assertFails(b1.commit());
  // a free number: claim + profile together
  const b2 = writeBatch(db);
  b2.set(doc(db, 'phoneIndex', NEW.phone), { uid: NEW.uid });
  b2.set(doc(db, 'users/newbie'), { name: 'N', phone: NEW.phone });
  await assertSucceeds(b2.commit());
  // can't change the number later, can't write someone else's profile
  await assertFails(updateDoc(doc(db, 'users/newbie'), { phone: '+919000000010' }));
  await assertSucceeds(updateDoc(doc(db, 'users/newbie'), { name: 'Newbie' }));
  await assertFails(setDoc(doc(db, 'users/admin'), { name: 'X', phone: NEW.phone }));
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

test('invites: invited number can ask to join, only an admin can let them in', async () => {
  const q = query(collection(as(INVITEE), 'chats'), where('pendingPhones', 'array-contains', INVITEE.phone));
  const snap = await assertSucceeds(getDocs(q));
  if (snap.size !== 1) throw new Error('invitee should see 1 group');
  // can't add anyone else, can't touch admins
  await assertFails(updateDoc(doc(as(INVITEE), 'chats/g1'), { members: arrayUnion(INVITEE.uid, 'someone'), pendingPhones: arrayRemove(INVITEE.phone) }));
  await assertFails(updateDoc(doc(as(INVITEE), 'chats/g1'), { members: arrayUnion(INVITEE.uid), admins: arrayUnion(INVITEE.uid), pendingPhones: arrayRemove(INVITEE.phone) }));
  // someone whose number wasn't invited can't even ask
  await assertFails(updateDoc(doc(as(OUTSIDER), 'chats/g1'), { joinRequests: arrayUnion(OUTSIDER.uid) }));
  // invited number asks
  await assertSucceeds(updateDoc(doc(as(INVITEE), 'chats/g1'), { joinRequests: arrayUnion(INVITEE.uid) }));
  await assertSucceeds(getDocs(query(collection(as(INVITEE), 'chats'), where('joinRequests', 'array-contains', INVITEE.uid))));
  // a normal member can't approve, the admin can
  await assertFails(updateDoc(doc(as(MEMBER), 'chats/g1'), { members: arrayUnion(INVITEE.uid), joinRequests: arrayRemove(INVITEE.uid) }));
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'chats/g1'), { members: arrayUnion(INVITEE.uid), joinRequests: arrayRemove(INVITEE.uid), pendingPhones: arrayRemove(INVITEE.phone) }));
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
  const c = { kind: 'video', chatId: 'g1', chatName: 'Gym', isGroup: true, callerId: ADMIN.uid, callerName: 'A', invited: [MEMBER.uid], ringingFor: [MEMBER.uid], joined: [ADMIN.uid], declined: [], status: 'ringing', createdAt: serverTimestamp() };
  await assertFails(setDoc(doc(as(OUTSIDER), 'calls/c1'), { ...c, callerId: OUTSIDER.uid }));
  await assertSucceeds(setDoc(doc(as(ADMIN), 'calls/c1'), c));
  const q = query(collection(as(MEMBER), 'calls'), where('ringingFor', 'array-contains', MEMBER.uid));
  await assertSucceeds(getDocs(q));
  await assertSucceeds(updateDoc(doc(as(MEMBER), 'calls/c1'), { joined: arrayUnion(MEMBER.uid), ringingFor: arrayRemove(MEMBER.uid), status: 'ongoing' }));
  await assertFails(getDoc(doc(as(OUTSIDER), 'calls/c1')));
});

test('direct chats: 1:1 id must match both members', async () => {
  await assertSucceeds(getDoc(doc(as(MEMBER), 'chats/dm_admin_member'))); // doesn't exist yet
  await assertSucceeds(setDoc(doc(as(MEMBER), 'chats/dm_admin_member'), { type: 'direct', members: ['admin', 'member'], admins: [], createdBy: 'member', pendingPhones: [] }));
  await assertFails(setDoc(doc(as(OUTSIDER), 'chats/dm_admin_member2'), { type: 'direct', members: ['admin', 'member'], admins: [], createdBy: 'outsider', pendingPhones: [] }));
});

test('calls: can only ring people in the same chat, as voice or video', async () => {
  const c = { kind: 'voice', chatId: 'g1', chatName: 'Gym', isGroup: true, callerId: MEMBER.uid, callerName: 'M', invited: [ADMIN.uid], ringingFor: [ADMIN.uid], joined: [MEMBER.uid], declined: [], status: 'ringing' };
  await assertSucceeds(setDoc(doc(as(MEMBER), 'calls/v1'), c));
  // someone who is not in the group
  await assertFails(setDoc(doc(as(MEMBER), 'calls/v2'), { ...c, invited: [ADMIN.uid, OUTSIDER.uid], ringingFor: [ADMIN.uid, OUTSIDER.uid] }));
  // must be voice or video
  await assertFails(setDoc(doc(as(MEMBER), 'calls/v3'), { ...c, kind: 'phone' }));
  // ringingFor must match the invited list
  await assertFails(setDoc(doc(as(MEMBER), 'calls/v6'), { ...c, ringingFor: [ADMIN.uid, OUTSIDER.uid] }));
  // nobody to ring / ringing yourself
  await assertFails(setDoc(doc(as(MEMBER), 'calls/v4'), { ...c, invited: [], ringingFor: [] }));
  await assertFails(setDoc(doc(as(MEMBER), 'calls/v5'), { ...c, invited: [MEMBER.uid], ringingFor: [MEMBER.uid] }));
});

test('calls: any app user can call any other app user 1:1', async () => {
  // OUTSIDER shares no group with INVITEE, but can open a 1:1 chat and call them.
  await assertSucceeds(setDoc(doc(as(OUTSIDER), 'chats/dm_invitee_outsider'), { type: 'direct', members: ['invitee', 'outsider'], admins: [], createdBy: 'outsider', pendingPhones: [] }));
  const c = { kind: 'video', chatId: 'dm_invitee_outsider', chatName: 'I', isGroup: false, callerId: OUTSIDER.uid, callerName: 'O', invited: [INVITEE.uid], ringingFor: [INVITEE.uid], joined: [OUTSIDER.uid], declined: [], status: 'ringing' };
  await assertSucceeds(setDoc(doc(as(OUTSIDER), 'calls/d1'), c));
  await assertSucceeds(updateDoc(doc(as(INVITEE), 'calls/d1'), { joined: arrayUnion(INVITEE.uid), status: 'ongoing' }));
  // a third person can't see or join it
  await assertFails(getDoc(doc(as(MEMBER), 'calls/d1')));
  await assertFails(updateDoc(doc(as(MEMBER), 'calls/d1'), { joined: arrayUnion(MEMBER.uid) }));
});

test('users: can mark own app as installed/uninstalled only', async () => {
  await assertSucceeds(updateDoc(doc(as(MEMBER), 'users/member'), { appInstalled: false }));
  await assertFails(updateDoc(doc(as(ADMIN), 'users/member'), { appInstalled: true }));
});

test('invite links: admin makes a link, anyone signed in can join with the current code only', async () => {
  // admin creates the link
  const adb = as(ADMIN);
  const b = writeBatch(adb);
  b.set(doc(adb, 'invites/Code1234567890AB'), { chatId: 'g1', name: 'Gym', createdBy: ADMIN.uid });
  b.update(doc(adb, 'chats/g1'), { inviteCode: 'Code1234567890AB' });
  await assertSucceeds(b.commit());
  // a member can't make links; nobody can list them
  await assertFails(setDoc(doc(as(MEMBER), 'invites/Code9999999999XY'), { chatId: 'g1', name: 'Gym' }));
  await assertFails(getDocs(collection(as(OUTSIDER), 'invites')));
  // someone with the link can read the group name
  await assertSucceeds(getDoc(doc(as(OUTSIDER), 'invites/Code1234567890AB')));
  // wrong code fails, adding someone else fails, right code works
  await assertFails(updateDoc(doc(as(OUTSIDER), 'chats/g1'), { members: arrayUnion(OUTSIDER.uid), lastJoinCode: 'WrongCode0000000' }));
  await assertFails(updateDoc(doc(as(OUTSIDER), 'chats/g1'), { members: arrayUnion(OUTSIDER.uid, 'friend'), lastJoinCode: 'Code1234567890AB' }));
  await assertFails(updateDoc(doc(as(OUTSIDER), 'chats/g1'), { members: arrayUnion(OUTSIDER.uid), admins: arrayUnion(OUTSIDER.uid), lastJoinCode: 'Code1234567890AB' }));
  await assertSucceeds(updateDoc(doc(as(OUTSIDER), 'chats/g1'), { members: arrayUnion(OUTSIDER.uid), lastJoinCode: 'Code1234567890AB' }));
  // after a reset the old code stops working
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'chats/g1'), { inviteCode: 'NewCode123456789' }));
  await assertFails(updateDoc(doc(as(INVITEE), 'chats/g1'), { members: arrayUnion(INVITEE.uid), lastJoinCode: 'Code1234567890AB' }));
});

test('auto-join: a number the admin added joins by itself after registering; others cannot', async () => {
  // someone whose number was NOT added can't join this way
  await assertFails(updateDoc(doc(as(OUTSIDER), 'chats/g1'), { members: arrayUnion(OUTSIDER.uid), pendingPhones: arrayRemove(OUTSIDER.phone) }));
  // the invited number joins and removes only its own number
  await assertSucceeds(updateDoc(doc(as(INVITEE), 'chats/g1'), { members: arrayUnion(INVITEE.uid), pendingPhones: arrayRemove(INVITEE.phone) }));
  let snap;
  await env.withSecurityRulesDisabled(async (ctx) => {
    snap = (await getDoc(doc(ctx.firestore(), 'chats/g1'))).data();
  });
  if (!snap.members.includes(INVITEE.uid) || snap.pendingPhones.includes(INVITEE.phone)) throw new Error('not joined');
});

test('main admin vs second admins', async () => {
  // main admin appoints MEMBER as a second admin
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'chats/g1'), { admins: arrayUnion(MEMBER.uid) }));
  const sec = as(MEMBER);
  // second admin can add and remove normal members, rename the group
  await assertSucceeds(updateDoc(doc(sec, 'chats/g1'), { members: arrayUnion('newbie') }));
  await assertSucceeds(updateDoc(doc(sec, 'chats/g1'), { members: arrayRemove('newbie') }));
  await assertSucceeds(updateDoc(doc(sec, 'chats/g1'), { name: 'Gym 2' }));
  // …but can't appoint admins, dismiss or remove the main admin, or take over as main admin
  await assertFails(updateDoc(doc(sec, 'chats/g1'), { admins: arrayUnion('newbie') }));
  await assertFails(updateDoc(doc(sec, 'chats/g1'), { admins: arrayRemove(ADMIN.uid) }));
  await assertFails(updateDoc(doc(sec, 'chats/g1'), { members: arrayRemove(ADMIN.uid) }));
  await assertFails(updateDoc(doc(sec, 'chats/g1'), { createdBy: MEMBER.uid }));
  // second admin steps down
  await assertSucceeds(updateDoc(doc(sec, 'chats/g1'), { admins: arrayRemove(MEMBER.uid) }));
  // main admin can appoint again and dismiss
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'chats/g1'), { admins: arrayUnion(MEMBER.uid) }));
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'chats/g1'), { admins: arrayRemove(MEMBER.uid) }));
  // main admin leaving hands over the main-admin role
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'chats/g1'), { createdBy: MEMBER.uid, admins: [MEMBER.uid], members: arrayRemove(ADMIN.uid) }));
});

test('second admin cannot remove another admin', async () => {
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'chats/g1'), { admins: arrayUnion(MEMBER.uid, 'other'), members: arrayUnion('other') }));
  await assertFails(updateDoc(doc(as(MEMBER), 'chats/g1'), { members: arrayRemove('other') }));
});
