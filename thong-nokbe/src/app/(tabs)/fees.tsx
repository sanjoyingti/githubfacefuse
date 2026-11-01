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
import { clearPayment, recordPayment, sendFeeReminder, useMonthPayments } from '../../lib/fees';
import { IOS_UPI_APPS, makeTxnRef, payWithUpi } from '../../lib/upi';
import { addMonths, formatMonth, monthKey, parseMonthKey } from '../../lib/dates';
import { displayName, useUsers } from '../../lib/users';
import { colors } from '../../theme';
import type { FeePayment, UserProfile } from '../../lib/types';

const methodLabel: Record<FeePayment['method'], string> = { upi: 'UPI (verified by app)', 'upi-manual': 'UPI (UTR entered)', cash: 'Marked by admin' };

export default function Fees() {
  const me = useMe();
  const { selectedGroup: group, loading } = useChats();
  const [month, setMonth] = useState(monthKey());
  const { payments } = useMonthPayments(group?.id, month);
  const users = useUsers(group?.members ?? []);
  const [paying, setPaying] = useState(false);
  const [utrOpen, setUtrOpen] = useState(false);
  const [reminded, setReminded] = useState<Record<string, boolean>>({});
  const [reminding, setReminding] = useState<string | null>(null);

  const members = useMemo(
    () => (group?.members ?? []).map((uid) => users[uid] ?? ({ uid, name: '…', phone: '' } as UserProfile)).sort((a, b) => Number(!!payments[a.uid]) - Number(!!payments[b.uid]) || a.name.localeCompare(b.name)),
    [group?.members, users, payments],
  );

  if (loading) return <Loading />;
  if (!group) return <NoGroups />;

  const isAdmin = group.admins.includes(me.uid);
  const upi = group.upi;
  const monthDate = parseMonthKey(month);
  const isCurrent = month === monthKey();
  const mine = payments[me.uid];
  const paidCount = members.filter((m) => payments[m.uid]).length;
  const collected = Object.values(payments).reduce((s, p) => s + (p.amount || 0), 0);
  const dueLabel = `Due 1 ${monthDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;

  const startPay = async (iosScheme?: string) => {
    if (!upi) return;
    setPaying(true);
    try {
      const ref = makeTxnRef(group.id, month, me.uid);
      const res = await payWithUpi(upi, { note: `${group.name} gym fee ${formatMonth(monthDate)} - ${me.name}`, ref, iosScheme });
      if (res.outcome === 'success') {
        await recordPayment(group.id, month, me.uid, { amount: upi.amount, method: 'upi', txnId: res.txnId, recordedBy: me.uid, upiResponse: res.raw });
        Alert.alert('Payment successful ✅', `Your ${formatMonth(monthDate)} fee is marked as paid.`);
      } else if (res.outcome === 'failed') {
        Alert.alert('Payment failed', 'The UPI app reported the payment did not go through. No money should have been deducted. Please try again.');
      } else {
        Alert.alert('Did the payment go through?', 'Your UPI app did not report the result back. If the money was sent, confirm with the UPI reference (UTR) number.', [
          { text: 'Not paid', style: 'cancel' },
          { text: 'Yes, I paid', onPress: () => setUtrOpen(true) },
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

  const remind = async (targets: UserProfile[]) => {
    if (!targets.length) return;
    setReminding(targets.length > 1 ? 'all' : targets[0].uid);
    try {
      for (const t of targets) {
        await sendFeeReminder(me, t, group.name ?? 'Gym', upi?.amount, formatMonth(monthDate));
        setReminded((r) => ({ ...r, [t.uid]: true }));
      }
      Alert.alert('Reminder sent 🔔', targets.length > 1 ? `Sent to ${targets.length} members who haven't paid.` : `Sent to ${targets[0].name}.`);
    } catch (e: any) {
      Alert.alert('Could not send', e?.message ?? String(e));
    } finally {
      setReminding(null);
    }
  };

  const unpaidOthers = members.filter((m) => !payments[m.uid] && m.uid !== me.uid && m.phone);

  const onMember = (m: UserProfile) => {
    if (!isAdmin) return;
    const p = payments[m.uid];
    if (p) {
      Alert.alert(`${m.name} — paid`, `₹${p.amount} · ${methodLabel[p.method]}${p.txnId ? `\nRef: ${p.txnId}` : ''}`, [
        { text: 'Close', style: 'cancel' },
        { text: 'Mark as NOT paid', style: 'destructive', onPress: () => clearPayment(group.id, month, m.uid).catch((e) => Alert.alert('Error', e.message)) },
      ]);
    } else {
      Alert.alert(`${m.name} — not paid`, `Mark ${formatMonth(monthDate)} fee as received (cash or other payment)?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark as paid',
          onPress: () =>
            recordPayment(group.id, month, m.uid, { amount: upi?.amount ?? 0, method: 'cash', recordedBy: me.uid }).catch((e) => Alert.alert('Error', e.message)),
        },
      ]);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <GroupSwitcher />
      <View style={styles.monthBar}>
        <Pressable onPress={() => setMonth(monthKey(addMonths(monthDate, -1)))} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.monthText}>{formatMonth(monthDate)}</Text>
        <Pressable onPress={() => setMonth(monthKey(addMonths(monthDate, 1)))} hitSlop={12} disabled={isCurrent}>
          <Ionicons name="chevron-forward" size={26} color={isCurrent ? colors.border : colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* My status */}
        <View style={[styles.myCard, { backgroundColor: mine ? colors.paid : colors.unpaid }]}>
          <Text style={styles.myLabel}>Your fee · {formatMonth(monthDate)}</Text>
          <Text style={styles.myStatus}>{mine ? 'PAID ✅' : 'NOT PAID ❌'}</Text>
          <Text style={styles.myDetail}>
            {mine
              ? `₹${mine.amount} · ${mine.paidAt ? mine.paidAt.toDate().toLocaleDateString('en-IN') : 'just now'} · ${methodLabel[mine.method]}`
              : upi
                ? `₹${upi.amount} · ${dueLabel}${isCurrent && new Date().getDate() > 1 ? ' (overdue)' : ''}`
                : dueLabel}
          </Text>
          {!mine &&
            (upi ? (
              <Pressable style={styles.payBtn} onPress={pay} disabled={paying}>
                <Ionicons name="flash" size={18} color={colors.unpaid} />
                <Text style={styles.payText}>{paying ? 'Opening UPI app…' : `Pay ₹${upi.amount} now`}</Text>
              </Pressable>
            ) : (
              <Text style={[styles.myDetail, { marginTop: 10 }]}>The admin hasn't added a UPI ID yet.</Text>
            ))}
        </View>

        {upi ? (
          <Card>
            <Text style={styles.cardTitle}>Pay to (group admin)</Text>
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
            <UpiQr upi={upi} />
            <Text style={{ color: colors.muted, marginTop: 6, fontSize: 13, textAlign: 'center' }}>Scan with any UPI app from another phone</Text>
            <Text style={{ color: colors.muted, marginTop: 8, fontSize: 12 }}>Monthly fee ₹{upi.amount} · due on the 1st of every month</Text>
          </Card>
        ) : null}
        {isAdmin && (
          <Button
            title={upi ? 'Edit fee & UPI settings' : 'Add your UPI ID to collect fees'}
            variant={upi ? 'outline' : 'primary'}
            onPress={() => router.push({ pathname: '/group/fee-settings', params: { id: group.id } })}
            style={{ marginBottom: 12 }}
          />
        )}

        <View style={styles.totals}>
          <Text style={{ fontWeight: '800', color: colors.text }}>
            {paidCount}/{members.length} paid
          </Text>
          <Text style={{ color: colors.muted }}>Collected ₹{collected}</Text>
        </View>
        {isAdmin && unpaidOthers.length > 0 && (
          <Button
            title={reminding === 'all' ? 'Sending…' : `🔔 Remind all unpaid (${unpaidOthers.length})`}
            variant="outline"
            onPress={() =>
              Alert.alert('Send fee reminder?', `A reminder for ${formatMonth(monthDate)} will go to ${unpaidOthers.length} member(s) who haven't paid.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Send', onPress: () => remind(unpaidOthers) },
              ])
            }
            loading={reminding === 'all'}
            style={{ marginBottom: 10 }}
          />
        )}
        {isAdmin && <Text style={styles.hint}>Tap a member to mark cash payments or undo a payment. Tap 🔔 to remind one person.</Text>}
        {members.map((m) => {
          const p = payments[m.uid];
          return (
            <Pressable key={m.uid} onPress={() => onMember(m)} style={[styles.memberRow, { backgroundColor: p ? colors.paidBg : colors.unpaidBg, borderLeftColor: p ? colors.paid : colors.unpaid }]}>
              <Avatar name={m.name} size={38} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.memberName}>{m.uid === me.uid ? `${displayName(m)} (You)` : displayName(m)}</Text>
                <Text style={{ color: p ? colors.paid : colors.unpaid, fontSize: 12, fontWeight: '600' }}>
                  {p ? `Paid ₹${p.amount}${p.paidAt ? ' on ' + p.paidAt.toDate().toLocaleDateString('en-IN') : ''}` : `Unpaid · ${dueLabel}`}
                </Text>
              </View>
              {isAdmin && !p && m.uid !== me.uid ? (
                <Pressable
                  onPress={() => remind([m])}
                  disabled={!!reminding}
                  style={[styles.remindBtn, reminded[m.uid] && { backgroundColor: colors.paidBg, borderColor: colors.paid }]}
                  accessibilityLabel={`Remind ${m.name}`}
                >
                  <Text style={{ fontWeight: '800', color: reminded[m.uid] ? colors.paid : colors.unpaid }}>
                    {reminding === m.uid ? '…' : reminded[m.uid] ? 'Sent ✓' : '🔔 Remind'}
                  </Text>
                </Pressable>
              ) : (
                <Ionicons name={p ? 'checkmark-circle' : 'close-circle'} size={26} color={p ? colors.paid : colors.unpaid} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      <UtrModal
        open={utrOpen}
        onClose={() => setUtrOpen(false)}
        onSubmit={async (utr) => {
          if (!upi) return;
          await recordPayment(group.id, month, me.uid, { amount: upi.amount, method: 'upi-manual', txnId: utr, recordedBy: me.uid });
          setUtrOpen(false);
          Alert.alert('Marked as paid ✅', 'Your admin can see the UTR number to verify the payment.');
        }}
      />
    </View>
  );
}

function UtrModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (utr: string) => Promise<void> }) {
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^[A-Za-z0-9]{8,30}$/.test(utr.trim());
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>Confirm your payment</Text>
          <Text style={{ color: colors.muted, marginVertical: 8 }}>Enter the 12-digit UPI reference / UTR number from your UPI app's payment receipt.</Text>
          <TextInput value={utr} onChangeText={setUtr} placeholder="e.g. 431298765432" autoCapitalize="characters" style={styles.utrInput} placeholderTextColor={colors.muted} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button
              title="Mark paid"
              disabled={!valid}
              loading={busy}
              style={{ flex: 1 }}
              onPress={async () => {
                setBusy(true);
                try {
                  await onSubmit(utr.trim());
                  setUtr('');
                } catch (e: any) {
                  Alert.alert('Error', e?.message ?? String(e));
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
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10 },
  monthText: { fontWeight: '800', color: colors.text, fontSize: 16 },
  myCard: { borderRadius: 20, padding: 18, marginBottom: 12 },
  myLabel: { color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  myStatus: { color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 4 },
  myDetail: { color: '#fff', marginTop: 4 },
  payBtn: { marginTop: 14, backgroundColor: '#fff', borderRadius: 12, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  payText: { color: colors.unpaid, fontWeight: '900', fontSize: 16 },
  cardTitle: { color: colors.muted, fontWeight: '700', marginBottom: 6 },
  totals: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 8 },
  hint: { color: colors.muted, fontSize: 12, marginBottom: 8 },
  remindBtn: { borderWidth: 2, borderColor: colors.unpaid, borderRadius: 18, paddingHorizontal: 10, height: 36, justifyContent: 'center', backgroundColor: '#fff' },
  memberRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 14, marginBottom: 8, borderLeftWidth: 5 },
  memberName: { fontWeight: '700', color: colors.text },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 18 },
  utrInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, height: 48, paddingHorizontal: 14, fontSize: 18, letterSpacing: 2, color: colors.text },
});
