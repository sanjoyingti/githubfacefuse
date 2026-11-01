import type { Timestamp as FsTimestamp } from '@react-native-firebase/firestore';

export type Timestamp = FsTimestamp;

export interface UserProfile {
  uid: string;
  name: string;
  phone: string; // E.164, e.g. +919876543210
  about?: string;
  email?: string | null;
  /** false once the user logs out on every phone or uninstalls the app. */
  appInstalled?: boolean;
}

export interface UpiSettings {
  vpa: string; // e.g. gymowner@okaxis
  payeeName: string;
  amount: number; // monthly fee in INR
}

export interface Chat {
  id: string;
  type: 'group' | 'direct';
  name?: string; // groups only
  description?: string;
  members: string[];
  admins: string[]; // groups only (direct chats: empty)
  createdBy: string;
  pendingPhones: string[]; // invited numbers that haven't joined yet
  joinRequests?: string[]; // uids of people with an invited number, waiting for an admin to approve
  lastMessage?: { text: string; senderId: string; senderName: string; at: Timestamp | null } | null;
  updatedAt?: Timestamp | null;
  upi?: UpiSettings | null;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  type: 'text' | 'system' | 'call';
  createdAt: Timestamp | null;
}

export type AttendanceStatus = 'present' | 'absent';

export interface AttendanceDay {
  date: string; // yyyy-mm-dd
  month: string; // yyyy-mm
  records: Record<string, AttendanceStatus>;
  markedBy?: string;
}

export interface FeePayment {
  uid: string;
  month: string; // yyyy-mm
  status: 'paid';
  amount: number;
  method: 'upi' | 'upi-manual' | 'cash';
  txnId?: string | null;
  paidAt: Timestamp | null;
  recordedBy: string;
}

export type CallKind = 'video' | 'voice';

export interface Call {
  id: string;
  kind: CallKind;
  chatId: string;
  chatName: string;
  isGroup: boolean;
  callerId: string;
  callerName: string;
  invited: string[];
  ringingFor?: string[]; // invited people who haven't answered/declined yet
  joined: string[];
  declined: string[];
  status: 'ringing' | 'ongoing' | 'ended';
  createdAt: Timestamp | null;
}
