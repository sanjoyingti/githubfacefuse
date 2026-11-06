import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from '@react-native-firebase/firestore';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { db } from './firebase';
import { monthAdd, type LedgerEntry, type LedgerMethod } from './feeMath';
import type { Chat, UserProfile } from './types';

/**
 * The fee ledger: chats/{groupId}/ledger/{entryId}. Every payment, correction and confirmation is a
 * NEW entry; the database rules forbid deleting or rewriting entries (an admin may only move a
 * "pending" UTR payment to "confirmed" or "rejected"). Month statuses are worked out from it (feeMath).
 *
 * Records written by older app versions (chats/{id}/fees/{month}/payments/{uid}) are still read and
 * counted — they are never copied, moved or deleted, so nothing from before this update is lost.
 */
const ledgerCol = (chatId: string) => collection(db, 'chats', chatId, 'ledger');
const legacyCol = (chatId: string, month: string) => collection(db, 'chats', chatId, 'fees', month, 'payments');
export const SCHEMA_VERSION = 1;

const toMs = (t: any) => (t?.toMillis ? t.toMillis() : Date.now());

function fromDoc(id: string, d: any): LedgerEntry {
  return {
    id,
    uid: d.uid,
    kind: d.kind,
    amount: Number(d.amount) || 0,
    forMonth: d.forMonth,
    method: d.method,
    status: d.status,
    utr: d.utr ?? null,
    reversalOf: d.reversalOf ?? null,
    note: d.note ?? '',
    createdMs: toMs(d.createdAt),
    recordedBy: d.recordedBy,
  };
}

/** Old-version records from the last 2 years and the next year, counted as "this month paid". */
function useLegacyEntries(chatId: string | undefined): LedgerEntry[] {
  const [byMonth, setByMonth] = useState<Record<string, LedgerEntry[]>>({});
  useEffect(() => {
    if (!chatId) return;
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const months = Array.from({ length: 37 }, (_, i) => monthAdd(cur, i - 24));
    const unsubs = months.map((m) =>
      onSnapshot(
        legacyCol(chatId, m),
        (snap) =>
          setByMonth((prev) => ({
            ...prev,
            [m]: snap.docs.map((d) => {
              const v = d.data() as any;
              return {
                id: `legacy-${m}-${d.id}`,
                uid: d.id,
                kind: 'payment',
                amount: Number(v.amount) || 0,
                forMonth: m,
                method: 'legacy',
                status: 'confirmed',
                utr: v.txnId ?? null,
                note: `Recorded by an older app version (${v.method ?? 'payment'})`,
                createdMs: toMs(v.paidAt),
                recordedBy: v.recordedBy,
                fullMonth: true,
              } satisfies LedgerEntry;
            }),
          })),
        () => {},
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [chatId]);
  return useMemo(() => Object.values(byMonth).flat(), [byMonth]);
}

/** Every fee entry of a group, live (new ledger + old-version records). */
export function useGroupLedger(chatId: string | undefined) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!chatId) return;
    return onSnapshot(
      ledgerCol(chatId),
      (snap) => {
        setEntries(snap.docs.map((d) => fromDoc(d.id, d.data())));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [chatId]);
  const legacy = useLegacyEntries(chatId);
  const all = useMemo(() => [...legacy, ...entries], [legacy, entries]);
  const byUid = useMemo(() => {
    const out: Record<string, LedgerEntry[]> = {};
    for (const e of all) (out[e.uid] ??= []).push(e);
    return out;
  }, [all]);
  return { entries: all, byUid, loading };
}

/**
 * Add a payment. Members: their own UPI payment ('upi' = the UPI app reported success, or
 * 'upi-manual' = UTR entered, which waits for an admin). Admins: cash/other for anyone.
 * A UTR can only be used once in a group (utrs/{utr} is created with the entry).
 */
export async function addPayment(
  chat: Chat,
  by: UserProfile,
  p: { uid: string; amount: number; forMonth: string; method: Exclude<LedgerMethod, 'legacy' | 'gateway'>; utr?: string | null; note?: string },
) {
  const ref = doc(ledgerCol(chat.id));
  const batch = writeBatch(db);
  const utr = p.utr ? p.utr.trim().toUpperCase() : null;
  batch.set(ref, {
    uid: p.uid,
    kind: 'payment',
    amount: Math.round(p.amount),
    forMonth: p.forMonth,
    method: p.method,
    status: p.method === 'upi-manual' ? 'pending' : 'confirmed',
    utr,
    reversalOf: null,
    note: (p.note ?? '').slice(0, 200),
    recordedBy: by.uid,
    createdAt: serverTimestamp(),
    v: SCHEMA_VERSION,
  });
  if (utr) batch.set(doc(db, 'chats', chat.id, 'utrs', utr), { entryId: ref.id, uid: p.uid, createdAt: serverTimestamp() });
  await batch.commit();
  return ref.id;
}

/** Admin correction: cancels (part of) a payment with a new entry. The original stays in the history. */
export async function addReversal(chat: Chat, admin: UserProfile, of: LedgerEntry, amount: number, note: string) {
  const ref = doc(ledgerCol(chat.id));
  const batch = writeBatch(db);
  batch.set(ref, {
    uid: of.uid,
    kind: 'reversal',
    amount: Math.round(Math.min(amount, of.amount)),
    forMonth: of.forMonth,
    method: 'cash',
    status: 'confirmed',
    utr: null,
    reversalOf: of.id,
    note: note.slice(0, 200),
    recordedBy: admin.uid,
    createdAt: serverTimestamp(),
    v: SCHEMA_VERSION,
  });
  await batch.commit();
}

/** Admin checks a UTR in their bank/UPI app and confirms (or rejects) the member's payment. */
export async function verifyPayment(chat: Chat, admin: UserProfile, entry: LedgerEntry, ok: boolean) {
  const batch = writeBatch(db);
  batch.update(doc(ledgerCol(chat.id), entry.id), { status: ok ? 'confirmed' : 'rejected', verifiedBy: admin.uid, verifiedAt: serverTimestamp() });
  await batch.commit();
}

/** Admin backup: the whole fee history as a spreadsheet (CSV) to save or send anywhere. */
export async function exportLedgerCsv(chat: Chat, entries: LedgerEntry[], users: Record<string, UserProfile>) {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'Member', 'Phone', 'Type', 'Amount (Rs)', 'For month', 'Method', 'Status', 'UTR', 'Note'].map(q).join(',')];
  for (const e of [...entries].sort((a, b) => a.createdMs - b.createdMs)) {
    const u = users[e.uid];
    rows.push(
      [new Date(e.createdMs).toLocaleString('en-IN'), u?.name ?? e.uid, u?.phone ?? '', e.kind, e.kind === 'reversal' ? -e.amount : e.amount, e.forMonth, e.method, e.status, e.utr ?? '', e.note ?? '']
        .map(q)
        .join(','),
    );
  }
  const safe = (chat.name ?? 'group').replace(/[^A-Za-z0-9]+/g, '-');
  const path = `${FileSystem.cacheDirectory}${safe}-fees-${new Date().toISOString().slice(0, 10)}.csv`;
  await FileSystem.writeAsStringAsync(path, '﻿' + rows.join('\n'));
  await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Save or send the fee history' });
}
