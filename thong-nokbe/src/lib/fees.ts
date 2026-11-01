import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from '@react-native-firebase/firestore';
import { db } from './firebase';
import { getOrCreateDirectChat, sendMessage } from './chats';
import type { FeePayment, UserProfile } from './types';

const paymentsCol = (chatId: string, month: string) => collection(db, 'chats', chatId, 'fees', month, 'payments');

/** Live map uid -> payment for a month. Anyone missing from the map has not paid (red). */
export function useMonthPayments(chatId: string | undefined, month: string) {
  const [payments, setPayments] = useState<Record<string, FeePayment>>({});
  useEffect(() => {
    if (!chatId) return;
    return onSnapshot(
      paymentsCol(chatId, month),
      (snap) => {
        const out: Record<string, FeePayment> = {};
        snap.forEach((d) => {
          out[d.id] = { uid: d.id, ...(d.data() as Omit<FeePayment, 'uid'>) };
        });
        setPayments(out);
      },
      (e) => console.warn('listener error', e),
    );
  }, [chatId, month]);
  return { payments };
}

export async function recordPayment(
  chatId: string,
  month: string,
  uid: string,
  data: { amount: number; method: FeePayment['method']; txnId?: string | null; recordedBy: string; upiResponse?: string | null },
) {
  await setDoc(doc(paymentsCol(chatId, month), uid), {
    month,
    status: 'paid',
    amount: data.amount,
    method: data.method,
    txnId: data.txnId ?? null,
    upiResponse: data.upiResponse ?? null,
    recordedBy: data.recordedBy,
    paidAt: serverTimestamp(),
  });
}

/** Admin only: mark a member as unpaid again. */
export async function clearPayment(chatId: string, month: string, uid: string) {
  await deleteDoc(doc(paymentsCol(chatId, month), uid));
}

export const FEE_REMINDER_PREFIX = '🔔 Gym fee reminder';

/**
 * Admin → one member: a private message from the admin. The member's phone shows it as a notification
 * (while the app is open or running in the background) and it stays in their chats.
 */
export async function sendFeeReminder(admin: UserProfile, member: UserProfile, groupName: string, amount: number | undefined, monthLabel: string) {
  const chatId = await getOrCreateDirectChat(admin, member);
  const text =
    `${FEE_REMINDER_PREFIX} (${groupName}): Hi ${member.name}, your gym fee` +
    (amount ? ` of ₹${amount}` : '') +
    ` for ${monthLabel} is not paid yet. Please pay from the Fees tab. Thank you! – ${admin.name}`;
  await sendMessage(chatId, admin, text);
}

export const FEE_NOTICE_PREFIX = '📢 Fee notice';

/** Admin → everyone in the group: posted in the group chat; every member's phone shows a notification. */
export async function sendFeeNoticeToAll(admin: UserProfile, groupId: string, text: string) {
  const body = text.trim();
  if (!body) return;
  await sendMessage(groupId, admin, `${FEE_NOTICE_PREFIX}: ${body}`);
}
