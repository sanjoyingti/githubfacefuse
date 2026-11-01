import { useEffect, useState } from 'react';
import { collection, deleteField, doc, onSnapshot, query, serverTimestamp, setDoc, where } from '@react-native-firebase/firestore';
import { db } from './firebase';
import type { AttendanceDay, AttendanceStatus } from './types';

const attendanceCol = (chatId: string) => collection(db, 'chats', chatId, 'attendance');

/** Live attendance for every day of a month: { 'yyyy-mm-dd': { uid: 'present' | 'absent' } } */
export function useMonthAttendance(chatId: string | undefined, month: string) {
  const [days, setDays] = useState<Record<string, AttendanceDay['records']>>({});
  useEffect(() => {
    if (!chatId) return;
    return onSnapshot(
      query(attendanceCol(chatId), where('month', '==', month)),
      (snap) => {
        const out: Record<string, AttendanceDay['records']> = {};
        snap.forEach((d) => {
          const v = d.data() as AttendanceDay;
          out[v.date] = v.records ?? {};
        });
        setDays(out);
      },
      (e) => console.warn('listener error', e),
    );
  }, [chatId, month]);
  return { days };
}

/** Admin only (enforced by security rules). Pass null to clear a mark. */
export async function markAttendance(chatId: string, date: string, adminUid: string, marks: Record<string, AttendanceStatus | null>) {
  const records: Record<string, unknown> = {};
  for (const [uid, s] of Object.entries(marks)) records[uid] = s ?? deleteField();
  await setDoc(
    doc(attendanceCol(chatId), date),
    { date, month: date.slice(0, 7), records, markedBy: adminUid, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
