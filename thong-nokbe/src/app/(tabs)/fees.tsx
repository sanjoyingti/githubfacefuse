import React, { useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useMe } from '../../context/AuthProvider';
import { useChats } from '../../context/ChatsProvider';
import { GroupSwitcher, NoGroups } from '../../components/GroupSwitcher';
import { Avatar, Button, Card, Loading } from '../../components/ui';
import { UpiQr } from '../../components/UpiQr';
import { ActionSheet, type SheetOption } from '../../components/ActionSheet';
import { sendFeeNoticeToAll, sendFeeReminder } from '../../lib/fees';
import { addPayment, addReversal, useGroupLedger, verifyPayment } from '../../lib/feeLedger';
import { allocate, feeFor, firstUnpaid, paidThrough, statusOf, totals, type LedgerEntry, type MonthInfo } from '../../lib/feeMath';
import { IOS_UPI_APPS, payWithUpi } from '../../lib/upi';
import { addMonths, formatMonth, monthKey, parseMonthKey } from '../../lib/dates';
import { displayName, useUsers } from '../../lib/users';
import { colors } from '../../theme';
import type { UserProfile } from '../../lib/types';

const METHOD: Record<string, string> = {
  upi: 'UPI (confirmed by UPI app)',
  'upi-manual': 'UPI (UTR)',
  cash: 'Cash / recorded by admin',
  gateway: 'Online payment',
  legacy: 'Recorded earlier',
};
const look = (s: MonthInfo['status']) =>
  s === 'paid' ? { fg: colors.paid, bg: colors.paidBg, icon: 'checkmark-circle' as const } : s === 'partial' ? { fg: colors.warnText, bg: colors.warnBg, icon: 'pie-chart' as const } : { fg: colors.unpaid, bg: colors.unpaidBg, icon: 'close-circle' as const };
const label = (m: string) => formatMonth(parseMonthKey(m));
const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
};
const rs = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export default function Fees() {
  const me = useMe();
  const { selectedGroup: group, loading } = useChats();
  const [month, setMonth] = useState(monthKey());
  const { byUid, entries } = useGroupLedger(group?.id);
  const users = useUsers(group?.members ?? []);
  const [paying, setPaying] = useState(false);
  const [amountChoice, setAmountChoice] = useState<number | null>(null);
  const [modal, setModal] = useState<null | { kind: 'utr' | 'custom' | 'cash'; member?: UserProfile }>(null);
  const [sheet, setSheet] = useState<{ title: string; options: SheetOption[] } | null>(null);
  const [reminded, setReminded] = useState<Record<string, boolean>>({});
  const [reminding, setReminding] = useState<string | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);

  const feeHistory = group?.feeHistory;
  const upiAmount = group?.upi?.amount;
  const steps = useMemo(() => feeHistory ?? (upiAmount ? [{ from: '2000-01', amount: upiAmount }] : []), [feeHistory, upiAmount]);
  const fallback = group?.upi?.amount ?? 0;
  // Every member's months, worked out from the permanent ledger (updates live for everyone).
  const monthsOf = useMemo(() => {
    const out: Record<string, Record<string, MonthInfo>> = {};
    for (const uid of group?.members ?? []) out[uid] = allocate(byUid[uid] ?? [], steps, fallback);
    return out;
  }, [group?.members, byUid, steps, fallback]);

  const members = useMemo(() => {
    const rank = { paid: 2, partial: 1, unpaid: 0 } as const;
    return (group?.members ?? [])
      .map((uid) => users[uid] ?? ({ uid, name: '…', phone: '' } as UserProfile))
      .sort((a, b) => rank[statusOf(monthsOf[a.uid] ?? {}, month, steps, fallback).status] - rank[statusOf(monthsOf[b.uid] ?? {}, month, steps, fallback).status] || a.name.localeCompare(b.name));
  }, [group?.members, users, monthsOf, month, steps, fallback]);

  if (loading) return <Loading />;
  if (!group) return <NoGroups />;

  const isAdmin = group.admins.includes(me.uid);
  const upi = group.upi;
  const fee = feeFor(month, steps, fallback);
  const isCurrent = month === monthKey();
  const myMonths = monthsOf[me.uid] ?? {};
  const mine = statusOf(myMonths, month, steps, fallback);
  const myEntries = byUid[me.uid] ?? [];
  const myTotals = totals(myEntries);
  const myPending = myEntries.filter((e) => e.kind === 'payment' && e.status === 'pending');
  const startFrom = firstUnpaid(myMonths, month); // where my next payment starts
  const through = paidThrough(myMonths, month);
  const ahead = through && through > monthKey() ? monthsBetween(monthKey(), through) : 0;
  const left = mine.status === 'partial' ? mine.fee - mine.paid : 0;
  const choices = fee > 0 ? [...(left > 0 ? [{ label: `Rest of ${label(month)}`, amount: left }] : []), { label: '1 month', amount: fee }, { label: '3 months', amount: fee * 3 }, { label: '6 months', amount: fee * 6 }, { label: '12 months', amount: fee * 12 }] : [];
  const amount = amountChoice ?? (left > 0 ? left : fee);
  const pendingAll = entries.filter((e) => e.kind === 'payment' && e.status === 'pending');
  const paidCount = members.filter((m) => statusOf(monthsOf[m.uid] ?? {}, month, steps, fallback).status === 'paid').length;
  const collected = members.reduce((s, m) => s + statusOf(monthsOf[m.uid] ?? {}, month, steps, fallback).paid, 0);
  const myLook = look(mine.status);

  // ---- paying ------------------------------------------------------------------------------------------
  const startPay = async (iosScheme?: string) => {
    if (!upi || amount <= 0) return;
    setPaying(true);
    try {
      const res = await payWithUpi({ ...upi, amount }, { note: `${group.name} gym fee ${me.name}`, iosScheme });
      if (res.outcome === 'success') {
        await addPayment(group, me, { uid: me.uid, amount, forMonth: startFrom, method: 'upi' });
        Alert.alert('Payment successful ✅', `${rs(amount)} received. Everyone in the group sees it now.`);
        setAmountChoice(null);
      } else if (res.outcome === 'failed') {
        Alert.alert(
          'Payment did not go through',
          'Your UPI app stopped this payment. No money should have been deducted.\n\nSome UPI apps block direct payments to a personal UPI ID. Use "Pay by QR from this phone" below, then "Already paid? Enter UTR". If money WAS deducted, enter the UTR.',
        );
      } else {
        Alert.alert('Did the payment go through?', 'Your UPI app did not report the result. If the money was sent, confirm with the UPI reference (UTR) number.', [
          { text: 'Not paid', style: 'cancel' },
          { text: 'Yes, I paid', onPress: () => setModal({ kind: 'utr' }) },
        ]);
      }
    } catch (e: any) {
      Alert.alert('No UPI app found', e?.message?.includes('No Activity') ? 'Install Google Pay, PhonePe, Paytm or BHIM to pay.' : e?.message ?? String(e));
    } finally {
      setPaying(false);
    }
  };
  const pay = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Pay with', options: [...IOS_UPI_APPS.map((a) => a.name), 'Cancel'], cancelButtonIndex: IOS_UPI_APPS.length },
        (i) => i < IOS_UPI_APPS.length && startPay(IOS_UPI_APPS[i].scheme),
      );
    } else startPay();
  };

  // ---- admin -------------------------------------------------------------------------------------------
  const remind = async (targets: UserProfile[]) => {
    if (!targets.length) return;
    setReminding(targets.length > 1 ? 'all' : targets[0].uid);
    try {
      for (const t of targets) {
        await sendFeeReminder(me, t, group.name ?? 'Gym', fee || undefined, label(month));
        setReminded((r) => ({ ...r, [t.uid]: true }));
      }
      Alert.alert('Reminder sent 🔔', targets.length > 1 ? `Sent to ${targets.length} members who haven't fully paid.` : `Sent to ${targets[0].name}.`);
    } catch (e: any) {
      Alert.alert('Could not send', e?.message ?? String(e));
    } finally {
      setReminding(null);
    }
  };
  const unpaidOthers = members.filter((m) => m.uid !== me.uid && m.phone && statusOf(monthsOf[m.uid] ?? {}, month, steps, fallback).status !== 'paid');

  const confirmPending = (e: LedgerEntry, ok: boolean) => {
    const who = users[e.uid]?.name ?? 'Member';
    Alert.alert(
      ok ? 'Confirm this payment?' : 'Reject this payment?',
      ok ? `Check your bank or UPI app: did you receive ${rs(e.amount)} from ${who} with UTR ${e.utr}?` : `${who}'s ${rs(e.amount)} (UTR ${e.utr}) will not count. It stays in the history as rejected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: ok ? 'Yes, received' : 'Reject', style: ok ? 'default' : 'destructive', onPress: () => verifyPayment(group, me, e, ok).catch((er) => Alert.alert('Error', er.message)) },
      ],
    );
  };

  const onMember = (m: UserProfile) => {
    if (!isAdmin) return;
    const theirs = (byUid[m.uid] ?? []).filter((e) => e.kind === 'payment' && e.status === 'confirmed' && e.method !== 'legacy').sort((a, b) => b.createdMs - a.createdMs);
    const st = statusOf(monthsOf[m.uid] ?? {}, month, steps, fallback);
    const opts: SheetOption[] = [
      { label: `Record cash / other payment from ${m.name}`, icon: 'cash', onPress: () => setModal({ kind: 'cash', member: m }) },
      ...(theirs.length
        ? [
            {
              label: 'Correct a payment (reverse it)',
              icon: 'arrow-undo' as const,
              onPress: () =>
                setTimeout(
                  () =>
                    setSheet({
                      title: `Which payment of ${m.name}?`,
                      options: theirs.slice(0, 12).map((e) => ({
                        label: `${rs(e.amount)} · ${new Date(e.createdMs).toLocaleDateString('en-IN')} · ${METHOD[e.method] ?? e.method}`,
                        icon: 'receipt' as const,
                        destructive: true,
                        onPress: () =>
                          Alert.alert('Reverse this payment?', `${rs(e.amount)} from ${m.name} will no longer count. Nothing is deleted: the correction is added to the history.`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Reverse', style: 'destructive', onPress: () => addReversal(group, me, e, e.amount, `Reversed by ${me.name}`).catch((er) => Alert.alert('Error', er.message)) },
                          ]),
                      })),
                    }),
                  350,
                ),
            },
          ]
        : []),
      ...(st.status !== 'paid' && m.uid !== me.uid ? [{ label: `🔔 Remind ${m.name}`, icon: 'notifications' as const, onPress: () => remind([m]) }] : []),
    ];
    setSheet({ title: m.name, options: opts });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <GroupSwitcher />
      <View style={styles.monthBar}>
        <Pressable onPress={() => setMonth(monthKey(addMonths(parseMonthKey(month), -1)))} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.monthText}>{label(month)}</Text>
        <Pressable onPress={() => setMonth(monthKey(addMonths(parseMonthKey(month), 1)))} hitSlop={12}>
          <Ionicons name="chevron-forward" size={26} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* ---- My status ---- */}
        <View style={[styles.myCard, { backgroundColor: myLook.bg, borderColor: myLook.fg }]}>
          <Text style={styles.myLabel}>Your fee · {label(month)}</Text>
          <Text style={[styles.myStatus, { color: myLook.fg }]}>{mine.status === 'paid' ? 'PAID ✅' : mine.status === 'partial' ? 'PART PAID' : 'NOT PAID ❌'}</Text>
          <Text style={styles.myDetail}>
            {fee <= 0
              ? 'The admin has not set the monthly fee yet.'
              : mine.status === 'paid'
                ? `${rs(mine.fee)} paid`
                : mine.status === 'partial'
                  ? `${rs(mine.paid)} of ${rs(mine.fee)} paid · ${rs(left)} left`
                  : `${rs(fee)} · due on the 1st${isCurrent && new Date().getDate() > 1 ? ' (overdue)' : ''}`}
          </Text>
          {through && <Text style={styles.myDetail}>Paid up to {label(through)}{ahead > 0 ? ` · ${ahead} month${ahead > 1 ? 's' : ''} in advance 🎉` : ''}</Text>}
          <Text style={styles.mySmall}>Total paid so far: {rs(myTotals.paid)}</Text>
          {myPending.map((e) => (
            <Text key={e.id} style={styles.pending}>
              ⏳ {rs(e.amount)} (UTR {e.utr}) is waiting for the admin to confirm
            </Text>
          ))}
        </View>

        {/* ---- Pay any amount, any time ---- */}
        {upi && fee > 0 ? (
          <Card>
            <Text style={styles.cardTitle}>Pay any time — this month, ahead, or part of it</Text>
            <View style={styles.chips}>
              {choices.map((c) => (
                <Pressable key={c.label} style={[styles.chip, amount === c.amount && styles.chipOn]} onPress={() => setAmountChoice(c.amount)}>
                  <Text style={[styles.chipText, amount === c.amount && { color: '#0b0f0d' }]}>{c.label}</Text>
                  <Text style={[styles.chipSub, amount === c.amount && { color: '#0b0f0d' }]}>{rs(c.amount)}</Text>
                </Pressable>
              ))}
              <Pressable style={[styles.chip, !choices.some((c) => c.amount === amount) && styles.chipOn]} onPress={() => setModal({ kind: 'custom' })}>
                <Text style={[styles.chipText, !choices.some((c) => c.amount === amount) && { color: '#0b0f0d' }]}>Other amount</Text>
                <Text style={[styles.chipSub, !choices.some((c) => c.amount === amount) && { color: '#0b0f0d' }]}>{choices.some((c) => c.amount === amount) ? '✏️' : rs(amount)}</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>Counts from {label(startFrom)} onward. Extra money moves to the next months automatically.</Text>
            <Pressable style={[styles.payBtn, paying && { opacity: 0.6 }]} onPress={pay} disabled={paying}>
              <Ionicons name="flash" size={18} color="#fff" />
              <Text style={styles.payText}>{paying ? 'Opening UPI app…' : `Pay ${rs(amount)} now`}</Text>
            </Pressable>
          </Card>
        ) : (
          <Card>
            <Text style={{ color: colors.muted }}>{isAdmin ? 'Add the UPI ID and monthly fee so members can pay.' : "The group's admin hasn't added a UPI ID yet."}</Text>
          </Card>
        )}

        {upi && fee > 0 ? (
          <Card>
            <Text style={styles.cardTitle}>Pay to · “{group.name}” only</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{upi.payeeName}</Text>
                <Text style={{ color: colors.muted }}>{upi.vpa}</Text>
              </View>
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(upi.vpa);
                  Alert.alert('Copied', 'UPI ID copied');
                }}
                hitSlop={10}
              >
                <Ionicons name="copy-outline" size={22} color={colors.primary} />
              </Pressable>
            </View>
            <UpiQr upi={{ ...upi, amount }} shareable />
            <Text style={{ color: colors.muted, marginTop: 8, fontSize: 13, textAlign: 'center' }}>QR for {rs(amount)}. Scan with another phone, or tap “Pay by QR from this phone”.</Text>
            <Pressable onPress={() => setModal({ kind: 'utr' })} style={{ alignSelf: 'center', marginTop: 10 }} hitSlop={8}>
              <Text style={{ color: colors.primary, fontWeight: '800' }}>Already paid? Enter the UPI reference (UTR)</Text>
            </Pressable>
          </Card>
        ) : null}

        {isAdmin && (
          <Button
            title={upi ? `Edit “${group.name}” fee & UPI` : `Add a UPI ID for “${group.name}”`}
            variant={upi ? 'outline' : 'primary'}
            onPress={() => router.push({ pathname: '/group/fee-settings', params: { id: group.id } })}
            style={{ marginBottom: 12 }}
          />
        )}

        {/* ---- Admin: UTR payments to confirm ---- */}
        {isAdmin && pendingAll.length > 0 && (
          <Card>
            <Text style={[styles.cardTitle, { color: colors.warnText }]}>⏳ Waiting for your confirmation ({pendingAll.length})</Text>
            <Text style={styles.hint}>Check each UTR in your bank or UPI app, then confirm. Confirmed payments show as paid for everyone at once.</Text>
            {pendingAll.map((e) => (
              <View key={e.id} style={styles.pendingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{users[e.uid]?.name ?? 'Member'} · {rs(e.amount)}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>UTR {e.utr} · {new Date(e.createdMs).toLocaleDateString('en-IN')}</Text>
                </View>
                <Pressable style={[styles.smallBtn, { backgroundColor: colors.paid }]} onPress={() => confirmPending(e, true)}>
                  <Text style={styles.smallBtnText}>Confirm</Text>
                </Pressable>
                <Pressable style={[styles.smallBtn, { backgroundColor: colors.unpaid, marginLeft: 6 }]} onPress={() => confirmPending(e, false)}>
                  <Text style={styles.smallBtnText}>Reject</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        )}

        <View style={styles.totals}>
          <Text style={{ fontWeight: '800', color: colors.text }}>
            {paidCount}/{members.length} fully paid
          </Text>
          <Text style={{ color: colors.muted }}>Collected for {label(month)}: {rs(collected)}</Text>
        </View>
        {isAdmin && (
          <Button title="📊 Fee report & history" variant="outline" onPress={() => router.push({ pathname: '/group/fee-report', params: { id: group.id } })} style={{ marginBottom: 10 }} />
        )}
        {isAdmin && <Button title="📢 Notify all members about fees" onPress={() => setNoticeOpen(true)} style={{ marginBottom: 10 }} />}
        {isAdmin && unpaidOthers.length > 0 && (
          <Button
            title={reminding === 'all' ? 'Sending…' : `🔔 Remind all not fully paid (${unpaidOthers.length})`}
            variant="outline"
            onPress={() =>
              Alert.alert('Send fee reminder?', `A reminder for ${label(month)} will go to ${unpaidOthers.length} member(s).`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Send', onPress: () => remind(unpaidOthers) },
              ])
            }
            loading={reminding === 'all'}
            style={{ marginBottom: 10 }}
          />
        )}
        {isAdmin && <Text style={styles.hint}>Tap a member to record cash, correct a payment, or remind them.</Text>}

        {members.map((m) => {
          const st = statusOf(monthsOf[m.uid] ?? {}, month, steps, fallback);
          const l = look(st.status);
          const thr = paidThrough(monthsOf[m.uid] ?? {}, month);
          return (
            <Pressable key={m.uid} onPress={() => onMember(m)} style={[styles.memberRow, { backgroundColor: l.bg, borderLeftColor: l.fg }]}>
              <Avatar name={m.name} size={38} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.memberName}>{m.uid === me.uid ? `${displayName(m)} (You)` : displayName(m)}</Text>
                <Text style={{ color: l.fg, fontSize: 12, fontWeight: '700' }}>
                  {st.status === 'paid'
                    ? `Paid ${rs(st.fee)}${thr && thr > month ? ` · up to ${label(thr)}` : ''}`
                    : st.status === 'partial'
                      ? `Part paid ${rs(st.paid)} of ${rs(st.fee)}`
                      : `Not paid · ${rs(st.fee)}`}
                </Text>
              </View>
              {isAdmin && st.status !== 'paid' && m.uid !== me.uid ? (
                <Pressable
                  onPress={() => remind([m])}
                  disabled={!!reminding}
                  style={[styles.remindBtn, reminded[m.uid] && { backgroundColor: colors.paidBg, borderColor: colors.paid }]}
                  accessibilityLabel={`Remind ${m.name}`}
                >
                  <Text style={{ fontWeight: '800', color: reminded[m.uid] ? colors.paid : colors.unpaid }}>{reminding === m.uid ? '…' : reminded[m.uid] ? 'Sent ✓' : '🔔'}</Text>
                </Pressable>
              ) : (
                <Ionicons name={l.icon} size={26} color={l.fg} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <NoticeModal
        open={noticeOpen}
        defaultText={`Gym fee${fee ? ` of ${rs(fee)}` : ''} for ${label(month)} is due on the 1st. You can also pay ahead for several months. Please pay from the Fees tab in the app. Thank you! – ${me.name}`}
        onClose={() => setNoticeOpen(false)}
        onSend={async (text) => {
          await sendFeeNoticeToAll(me, group.id, text);
          setNoticeOpen(false);
          Alert.alert('Notice sent 📢', `All ${members.length - 1} member(s) of ${group.name} get it as a notification and in the group chat.`);
        }}
      />
      <AmountModal
        open={!!modal}
        kind={modal?.kind ?? 'custom'}
        who={modal?.member?.name}
        monthlyFee={fee}
        defaultAmount={modal?.kind === 'cash' ? Math.max(0, statusOf(monthsOf[modal.member!.uid] ?? {}, month, steps, fallback).fee - statusOf(monthsOf[modal.member!.uid] ?? {}, month, steps, fallback).paid) || fee : amount}
        onClose={() => setModal(null)}
        onSubmit={async (amt, utr) => {
          if (modal?.kind === 'custom') {
            setAmountChoice(amt);
          } else if (modal?.kind === 'utr') {
            await addPayment(group, me, { uid: me.uid, amount: amt, forMonth: startFrom, method: 'upi-manual', utr });
            Alert.alert('Sent for confirmation ⏳', `Your admin will check UTR ${utr} and confirm ${rs(amt)}. Then it shows as paid for everyone.`);
          } else if (modal?.kind === 'cash' && modal.member) {
            const from = firstUnpaid(monthsOf[modal.member.uid] ?? {}, month);
            await addPayment(group, me, { uid: modal.member.uid, amount: amt, forMonth: from, method: 'cash', note: `Recorded by ${me.name}` });
            Alert.alert('Recorded ✅', `${rs(amt)} from ${modal.member.name}, counted from ${label(from)}.`);
          }
          setModal(null);
        }}
      />
      <ActionSheet title={sheet?.title ?? null} options={sheet?.options ?? []} onClose={() => setSheet(null)} />
    </View>
  );
}

/** Amount (and UTR) input: custom amount to pay, "already paid" with UTR, or admin cash record. */
function AmountModal({
  open,
  kind,
  who,
  monthlyFee,
  defaultAmount,
  onClose,
  onSubmit,
}: {
  open: boolean;
  kind: 'utr' | 'custom' | 'cash';
  who?: string;
  monthlyFee: number;
  defaultAmount: number;
  onClose: () => void;
  onSubmit: (amount: number, utr?: string) => Promise<void>;
}) {
  const [amt, setAmt] = useState('');
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Math.round(Number(amt));
  const validAmt = n > 0 && n <= 1000000;
  const validUtr = kind !== 'utr' || /^[A-Za-z0-9]{8,30}$/.test(utr.trim());
  const title = kind === 'utr' ? 'Confirm your payment' : kind === 'cash' ? `Record a payment from ${who}` : 'Pay another amount';
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => {
        setAmt(String(defaultAmount || ''));
        setUtr('');
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{title}</Text>
          <Text style={{ color: colors.muted, marginVertical: 8 }}>
            {kind === 'utr'
              ? 'Enter the amount you paid and the 12-digit UPI reference (UTR) from your UPI app receipt. The admin confirms it.'
              : kind === 'cash'
                ? 'Cash or any other payment. It is added to the history (nothing is overwritten).'
                : 'Any amount: part of a month, or several months ahead.'}
            {monthlyFee > 0 ? ` Monthly fee: ₹${monthlyFee}.` : ''}
          </Text>
          <Text style={styles.fieldLabel}>Amount (₹)</Text>
          <TextInput value={amt} onChangeText={setAmt} keyboardType="number-pad" style={styles.input} placeholder="800" placeholderTextColor={colors.muted} />
          {kind === 'utr' && (
            <>
              <Text style={styles.fieldLabel}>UPI reference / UTR</Text>
              <TextInput value={utr} onChangeText={setUtr} placeholder="e.g. 431298765432" autoCapitalize="characters" style={[styles.input, { letterSpacing: 2 }]} placeholderTextColor={colors.muted} />
            </>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button
              title={kind === 'custom' ? 'Use amount' : kind === 'utr' ? 'Send' : 'Record'}
              disabled={!validAmt || !validUtr}
              loading={busy}
              style={{ flex: 1 }}
              onPress={async () => {
                setBusy(true);
                try {
                  await onSubmit(n, kind === 'utr' ? utr.trim().toUpperCase() : undefined);
                } catch (e: any) {
                  const dup = String(e?.message ?? '').includes('permission');
                  Alert.alert(dup && kind === 'utr' ? 'This UTR was already used' : 'Could not save', dup && kind === 'utr' ? 'Each UPI reference can be used once. Check the number.' : e?.message ?? String(e));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function NoticeModal({ open, defaultText, onClose, onSend }: { open: boolean; defaultText: string; onClose: () => void; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState(defaultText);
  const [busy, setBusy] = useState(false);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} onShow={() => setText(defaultText)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>📢 Fee notice to everyone</Text>
          <Text style={{ color: colors.muted, marginVertical: 8 }}>Every member of the group gets this as a notification and in the group chat. You can change the words.</Text>
          <TextInput value={text} onChangeText={setText} multiline style={styles.noticeInput} placeholderTextColor={colors.muted} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button
              title="Send 📢"
              disabled={!text.trim()}
              loading={busy}
              style={{ flex: 1 }}
              onPress={async () => {
                setBusy(true);
                try {
                  await onSend(text);
                } catch (e: any) {
                  Alert.alert('Could not send', e?.message ?? String(e));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 10 },
  monthText: { fontWeight: '800', color: colors.text, fontSize: 16 },
  myCard: { borderRadius: 20, padding: 18, marginBottom: 12, borderWidth: 2 },
  myLabel: { color: colors.muted, fontWeight: '700' },
  myStatus: { fontSize: 30, fontWeight: '900', marginTop: 4 },
  myDetail: { color: colors.text, marginTop: 4, fontWeight: '600' },
  mySmall: { color: colors.muted, marginTop: 6, fontSize: 13 },
  pending: { color: colors.warnText, marginTop: 6, fontSize: 13, fontWeight: '700' },
  cardTitle: { color: colors.muted, fontWeight: '700', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 2, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, minWidth: 96 },
  chipOn: { backgroundColor: '#fde047', borderColor: '#fde047' },
  chipText: { color: colors.text, fontWeight: '800', fontSize: 13 },
  chipSub: { color: colors.muted, fontWeight: '700', fontSize: 13, marginTop: 2 },
  payBtn: { marginTop: 12, backgroundColor: colors.primary, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  payText: { color: '#fff', fontWeight: '900', fontSize: 17 },
  totals: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 8, flexWrap: 'wrap', gap: 4 },
  hint: { color: colors.muted, fontSize: 12, marginVertical: 8 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border },
  smallBtn: { paddingHorizontal: 12, height: 34, borderRadius: 17, justifyContent: 'center' },
  smallBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  remindBtn: { borderWidth: 2, borderColor: colors.unpaid, borderRadius: 18, paddingHorizontal: 10, height: 36, justifyContent: 'center', backgroundColor: colors.card },
  memberRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 14, marginBottom: 8, borderLeftWidth: 5 },
  memberName: { fontWeight: '700', color: colors.text },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: colors.card, borderRadius: 20, padding: 18 },
  fieldLabel: { color: colors.muted, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, height: 48, paddingHorizontal: 14, fontSize: 18, color: colors.text },
  noticeInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, minHeight: 110, padding: 12, fontSize: 16, color: colors.text, textAlignVertical: 'top' },
});
