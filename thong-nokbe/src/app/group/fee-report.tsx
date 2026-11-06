import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { exportLedgerCsv, useGroupLedger } from '../../lib/feeLedger';
import { allocate, monthAdd, paidThrough, statusOf, totals } from '../../lib/feeMath';
import { formatMonth, monthKey, parseMonthKey } from '../../lib/dates';
import { displayName, useUsers } from '../../lib/users';
import { Avatar, Button, Empty } from '../../components/ui';
import { useBottomInset } from '../../components/useBottomInset';
import { colors } from '../../theme';

const METHOD: Record<string, string> = {
  upi: 'UPI (UPI app)',
  'upi-manual': 'UPI (UTR)',
  cash: 'Cash / admin',
  gateway: 'Online',
  legacy: 'Earlier record',
};
const rs = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const label = (m: string) => formatMonth(parseMonthKey(m));

/** Admins: the full, permanent fee history — every payment, correction and confirmation — and a backup file. */
export default function FeeReport() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const chat = useChat(id);
  const bottomInset = useBottomInset();
  const { byUid, entries, loading } = useGroupLedger(id);
  const users = useUsers(chat?.members ?? []);
  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const feeHistory = chat?.feeHistory;
  const upiAmount = chat?.upi?.amount;
  const steps = useMemo(() => feeHistory ?? (upiAmount ? [{ from: '2000-01', amount: upiAmount }] : []), [feeHistory, upiAmount]);
  const fallback = upiAmount ?? 0;
  const memberIds = chat?.members;
  const monthsOf = useMemo(() => Object.fromEntries((memberIds ?? []).map((u) => [u, allocate(byUid[u] ?? [], steps, fallback)])), [memberIds, byUid, steps, fallback]);

  if (!chat || !chat.admins.includes(me.uid)) return <Empty title="Only group admins can see the fee report" />;

  const yearMonths = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter((m) => m <= monthAdd(monthKey(), 12));
  const grand = entries.reduce((s, e) => s + (e.kind === 'payment' && e.status === 'confirmed' ? e.amount : 0) - (e.kind === 'reversal' && e.status === 'confirmed' ? e.amount : 0), 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 24 + bottomInset }}>
      <View style={styles.card}>
        <Text style={styles.big}>{rs(grand)}</Text>
        <Text style={styles.muted}>Collected in total · {entries.length} record{entries.length === 1 ? '' : 's'} kept permanently</Text>
        <Button
          title={exporting ? 'Preparing…' : '💾 Save / send full history (spreadsheet)'}
          variant="outline"
          loading={exporting}
          onPress={async () => {
            setExporting(true);
            try {
              await exportLedgerCsv(chat, entries, users);
            } catch (e: any) {
              Alert.alert('Could not export', e?.message ?? String(e));
            } finally {
              setExporting(false);
            }
          }}
          style={{ marginTop: 12 }}
        />
      </View>

      <View style={styles.yearBar}>
        <Pressable onPress={() => setYear((y) => y - 1)} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.yearText}>{year}</Text>
        <Pressable onPress={() => setYear((y) => y + 1)} hitSlop={12} disabled={year >= new Date().getFullYear() + 1}>
          <Ionicons name="chevron-forward" size={24} color={colors.text} />
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Month by month</Text>
        {yearMonths.map((m) => {
          const sts = chat.members.map((u) => statusOf(monthsOf[u] ?? {}, m, steps, fallback));
          const paid = sts.filter((s) => s.status === 'paid').length;
          const part = sts.filter((s) => s.status === 'partial').length;
          const sum = sts.reduce((s, x) => s + x.paid, 0);
          return (
            <View key={m} style={styles.monthRow}>
              <Text style={[styles.text, { width: 92 }]}>{label(m).replace(/ \d{4}$/, '')}</Text>
              <Text style={[styles.muted, { flex: 1 }]}>
                {paid} paid{part ? ` · ${part} part` : ''} / {chat.members.length}
              </Text>
              <Text style={styles.text}>{rs(sum)}</Text>
            </View>
          );
        })}
      </View>

      <Text style={[styles.title, { marginTop: 8, marginBottom: 8 }]}>Each member (tap for full history)</Text>
      {loading && <Text style={styles.muted}>Loading…</Text>}
      {chat.members.map((uid) => {
        const u = users[uid];
        const list = (byUid[uid] ?? []).slice().sort((a, b) => b.createdMs - a.createdMs);
        const t = totals(list);
        const thr = paidThrough(monthsOf[uid] ?? {}, monthKey());
        return (
          <View key={uid} style={styles.card}>
            <Pressable style={{ flexDirection: 'row', alignItems: 'center' }} onPress={() => setOpen(open === uid ? null : uid)}>
              <Avatar name={u?.name ?? '?'} size={38} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.text}>{displayName(u)}</Text>
                <Text style={styles.muted}>
                  Paid {rs(t.paid)}
                  {thr ? ` · up to ${label(thr)}` : ''}
                  {t.pending ? ` · ⏳ ${rs(t.pending)} to confirm` : ''}
                </Text>
              </View>
              <Ionicons name={open === uid ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />
            </Pressable>
            {open === uid &&
              (list.length ? (
                list.map((e) => (
                  <View key={e.id} style={styles.entry}>
                    <Text style={[styles.text, { color: e.kind === 'reversal' ? colors.unpaid : e.status === 'confirmed' ? colors.paid : colors.warnText }]}>
                      {e.kind === 'reversal' ? '− ' : '+ '}
                      {rs(e.amount)} · {e.kind === 'reversal' ? 'correction' : e.status}
                    </Text>
                    <Text style={styles.muted}>
                      {new Date(e.createdMs).toLocaleDateString('en-IN')} · from {label(e.forMonth)} · {METHOD[e.method] ?? e.method}
                      {e.utr ? ` · UTR ${e.utr}` : ''}
                    </Text>
                    {!!e.note && <Text style={styles.muted}>{e.note}</Text>}
                  </View>
                ))
              ) : (
                <Text style={[styles.muted, { marginTop: 8 }]}>No payments yet.</Text>
              ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 10 },
  big: { color: colors.text, fontSize: 28, fontWeight: '900' },
  title: { color: colors.text, fontWeight: '800', fontSize: 16 },
  text: { color: colors.text, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13, marginTop: 2 },
  yearBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 4 },
  yearText: { color: colors.text, fontWeight: '900', fontSize: 18 },
  monthRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderColor: colors.border },
  entry: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, marginTop: 8 },
});
