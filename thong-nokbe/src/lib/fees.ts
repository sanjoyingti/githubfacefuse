import { getOrCreateDirectChat, sendMessage } from './chats';
import type { UserProfile } from './types';

// Fee payments live in the permanent ledger (feeLedger.ts / feeMath.ts). This file keeps the reminder
// and notice messages.

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
