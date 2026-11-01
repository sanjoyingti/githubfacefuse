import { displayName, useUsers } from '../lib/users';
import type { Chat } from '../lib/types';

export function useChatTitle(chat: Chat | null, meUid: string) {
  const otherUid = chat?.type === 'direct' ? chat.members.find((m) => m !== meUid) : undefined;
  const users = useUsers(otherUid ? [otherUid] : []);
  if (!chat) return '';
  if (chat.type === 'group') return chat.name ?? 'Group';
  return displayName(otherUid ? users[otherUid] : null, 'Chat');
}
