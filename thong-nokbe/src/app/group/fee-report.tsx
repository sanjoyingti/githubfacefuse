import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { fetchYearPayments } from '../../lib/fees';
import { formatMonth, parseMonthKey } from '../../lib/dates';
import { displayName, useUsers } from '../../lib/users';
import { Avatar, Empty } from '../../components/ui';
import { useBottomInset } from '../../components/useBottomInset';
import { colors } from '../../theme';
import type { FeePayment } from '../../lib/types';

const METHOD: Record<FeePayment['method'], string> = { upi: 'UPI (confirmed by app)', 'upi-manual': 'UPI (UTR entered)', cash: 'Cash / marked by admin' };

/** Admins: how much each member has paid, month by month and for the whole year. */
export default function FeeReport() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const chat = useChat(id);
  const bottomInset = useBottomInset();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Record<string, Record<string, FeePayment>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const users = useUsers(chat?.members ?? []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetchYearPayments(id, year)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e?.message ?? String(e)));
    return () => {
      alive = false;
    };
  }, [id, year]);

  const months = useMemo(() => Object.keys(data ?? {}).sort().reverse(), [data]);
  const perMember = useMemo(() => {
    const out: Record<string, { total: number; payments: FeePayment[] }> = {};
    for (const uid of chat?.members ?? []) out[uid] = { total: 0, payments: [] };
    for (const m of months)
      for (const p of Object.values(data?.[m] ?? {})) {
        out[p.uid] ??= { total: 0, payments: [] };
        out[p.uid].total += p.amount || 0;
        out[p.uid].payments.push(p);
      }
    return Object.entries(out).sort((a, b) => b[1].total - a[1].total);
  }, [data, months, chat?.members]);

  if (!chat || chat.type !== 'group') return <Empty title="Group not found" />;
  if (!chat.admins.includes(me.uid)) return <Empty title="Only group admins can see the fee report" />;

  const yearTotal = perMember.reduce((s, [, v]) => s + v.total, 0);
  const isThisYear = year === new Date().getFullYear();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 30 + bottomInset }}>
      <View style={styles.yearBar}>
        <Pressable onPress={() => (setData(null), setYear((y) => y - 1))} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.yearText}>{year}</Text>
        <Pressable onPress={() => (setData(null), setYear((y) => y + 1))} hitSlop={12} disabled={isThisYear}>
          <Ionicons name="chevron-forward" size={26} color={isThisYear ? colors.border : colors.text} />
        </Pressable>
      </View>

      {error ? (
        <Text style={styles.err}>Could not load: {error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
      ) : (
        <>
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>💰 Total collected in {year}</Text>
            <Text style={styles.totalNum}>₹{yearTotal.toLocaleString('en-IN')}</Text>
          </View>

          <Text style={styles.section}>📅 Month by month</Text>
          {months.map((m) => {
            const ps = Object.values(data[m] ?? {});
            const sum = ps.reduce((s, p) => s + (p.amount || 0), 0);
            return (
              <View key={m} style={styles.monthRow}>
                <Text style={styles.monthName}>{formatMonth(parseMonthKey(m))}</Text>
                <Text style={styles.monthPaid}>
                  {ps.length}/{chat.members.length} paid
                </Text>
                <Text style={styles.monthSum}>₹{sum.toLocaleString('en-IN')}</Text>
              </View>
            );
          })}

          <Text style={styles.section}>👤 Paid by each member (tap for details)</Text>
          {perMember.map(([uid, v]) => {
            const u = users[uid];
            const expanded = open === uid;
            return (
              <View key={uid} style={styles.memberCard}>
                <Pressable style={styles.memberRow} onPress={() => setOpen(expanded ? null : uid)}>
                  <Avatar name={u?.name} size={40} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.memberName}>{u ? displayName(u) : 'Former member'}</Text>
                    <Text style={styles.memberSub}>
                      Paid {v.payments.length} month{v.payments.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Text style={[styles.memberTotal, !v.total && { color: colors.unpaid }]}>₹{v.total.toLocaleString('en-IN')}</Text>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} style={{ marginLeft: 6 }} />
                </Pressable>
                {expanded &&
                  (v.payments.length ? (
                    v.payments
                      .sort((a, b) => b.month.localeCompare(a.month))
                      .map((p) => (
                        <View key={p.month} style={styles.payRow}>
                          <Text style={styles.payMonth}>{formatMonth(parseMonthKey(p.month))}</Text>
                          <Text style={styles.payAmt}>₹{p.amount}</Text>
                          <Text style={styles.payMeta}>
                            {p.paidAt ? p.paidAt.toDate().toLocaleDateString('en-IN') : ''} · {METHOD[p.method] ?? p.method}
                            {p.txnId ? `\nRef/UTR: ${p.txnId}` : ''}
                          </Text>
                        </View>
                      ))
                  ) : (
                    <Text style={[styles.payMeta, { padding: 12 }]}>No payments in {year}.</Text>
                  ))}
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  yearBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 14, padding: 12, marginBottom: 12 },
  yearText: { color: colors.text, fontSize: 20, fontWeight: '900' },
  err: { color: colors.unpaid, textAlign: 'center', marginTop: 20 },
  totalCard: { backgroundColor: colors.paidBg, borderRadius: 16, padding: 16, marginBottom: 6 },
  totalLabel: { color: colors.text, fontWeight: '700' },
  totalNum: { color: colors.paid, fontSize: 32, fontWeight: '900', marginTop: 4 },
  section: { color: colors.text, fontWeight: '900', fontSize: 16, marginTop: 16, marginBottom: 8 },
  monthRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 6 },
  monthName: { flex: 1, color: colors.text, fontWeight: '700' },
  monthPaid: { color: colors.muted, marginRight: 12 },
  monthSum: { color: colors.paid, fontWeight: '900', minWidth: 70, textAlign: 'right' },
  memberCard: { backgroundColor: colors.card, borderRadius: 14, marginBottom: 8, overflow: 'hidden' },
  memberRow: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  memberName: { color: colors.text, fontWeight: '800', fontSize: 16 },
  memberSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  memberTotal: { color: colors.paid, fontWeight: '900', fontSize: 18 },
  payRow: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 10 },
  payMonth: { color: colors.text, fontWeight: '700' },
  payAmt: { position: 'absolute', right: 16, top: 10, color: colors.paid, fontWeight: '900' },
  payMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
});
