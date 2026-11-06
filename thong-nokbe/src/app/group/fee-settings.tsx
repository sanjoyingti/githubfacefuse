import React, { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { arrayUnion, updateDoc } from '@react-native-firebase/firestore';
import { feeFor } from '../../lib/feeMath';
import { monthKey } from '../../lib/dates';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { chatRef, sendMessage } from '../../lib/chats';
import { isValidVpa } from '../../lib/upi';
import { Button, Card, Empty, Input } from '../../components/ui';
import { UpiQr } from '../../components/UpiQr';
import { colors } from '../../theme';
import { useBottomInset } from '../../components/useBottomInset';

/** Fee steps to add. Groups set up before fee history existed keep their old fee for past months. */
function newSteps(steps: { from: string; amount: number }[], oldAmount: number | undefined, now: string, amt: number) {
  if (steps.length) return [{ from: now, amount: amt }];
  if (oldAmount && oldAmount !== amt) return [{ from: '2000-01', amount: oldAmount }, { from: now, amount: amt }];
  return [{ from: '2000-01', amount: amt }];
}

export default function FeeSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const bottomInset = useBottomInset();
  const chat = useChat(id);
  const [vpa, setVpa] = useState(chat?.upi?.vpa ?? '');
  const [payeeName, setPayeeName] = useState(chat?.upi?.payeeName ?? me.name);
  const [amount, setAmount] = useState(chat?.upi?.amount ? String(chat.upi.amount) : '');
  const [busy, setBusy] = useState(false);

  if (!chat || !chat.admins.includes(me.uid))
    return <Empty title="Only the group's admins can set its UPI" subtitle="Fees for this group are paid to the UPI ID the admin sets." />;

  const save = async () => {
    const amt = Number(amount);
    if (!isValidVpa(vpa)) return Alert.alert('Invalid UPI ID', 'Enter a UPI ID like yourname@okaxis or 9876543210@ybl');
    if (!payeeName.trim()) return Alert.alert('Payee name', 'Enter the name shown on your UPI account.');
    if (!amt || amt <= 0) return Alert.alert('Monthly fee', 'Enter the monthly gym fee in rupees.');
    setBusy(true);
    try {
      // The monthly fee is kept as a history: a new amount applies from this month on, and past months keep
      // the fee they had (nothing earlier is rewritten).
      const steps = chat.feeHistory ?? [];
      const now = monthKey();
      const changed = !steps.length || feeFor(now, steps, chat.upi?.amount ?? 0) !== amt;
      await updateDoc(chatRef(chat.id), {
        upi: { vpa: vpa.trim(), payeeName: payeeName.trim(), amount: amt },
        ...(changed ? { feeHistory: arrayUnion(...newSteps(steps, chat.upi?.amount, now, amt)) } : {}),
      });
      await sendMessage(chat.id, me, `${me.name} updated the gym fee: ₹${amt}/month, due on the 1st. Pay from the Fees tab.`, 'system');
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + bottomInset }} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text, marginBottom: 4 }}>UPI for “{chat.name}”</Text>
        <Text style={{ color: colors.muted, marginBottom: 14 }}>
          This UPI ID is used only for this group. Members of “{chat.name}” pay their fees to it; your other groups keep their own
          UPI. Fees are due on the 1st of every month. Tip: a business UPI ID (PhonePe Business, Google Pay for Business, Paytm
          Business — all free) lets members pay straight from the app without the UPI app blocking it.
        </Text>
        <Input label="Your UPI ID (VPA)" placeholder="gymowner@okaxis" autoCapitalize="none" autoCorrect={false} value={vpa} onChangeText={setVpa} />
        <Input label="Payee name" placeholder="Name on the UPI account" value={payeeName} onChangeText={setPayeeName} />
        <Input label="Monthly fee (₹) — 1 month" placeholder="500" keyboardType="number-pad" value={amount} onChangeText={setAmount} />
        {Number(amount) > 0 && (
          <Text style={{ color: colors.muted, marginTop: -4, marginBottom: 6 }}>
            Members see: 1 month ₹{Number(amount)} · 2 months ₹{Number(amount) * 2} · 3 months ₹{Number(amount) * 3} · 6 months ₹{Number(amount) * 6} · 12 months ₹{Number(amount) * 12}
          </Text>
        )}
      </Card>
      {isValidVpa(vpa) && Number(amount) > 0 ? (
        <Card>
          <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text }}>Your UPI QR code</Text>
          <Text style={{ color: colors.muted, marginTop: 4 }}>Made automatically from your UPI ID. Members see it in the Fees tab.</Text>
          <UpiQr upi={{ vpa: vpa.trim(), payeeName: payeeName.trim() || me.name, amount: Number(amount) }} size={160} />
        </Card>
      ) : null}
      <Button title="Save" onPress={save} loading={busy} />
    </ScrollView>
  );
}
