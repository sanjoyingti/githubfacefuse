import React, { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { updateDoc } from '@react-native-firebase/firestore';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { chatRef, sendMessage } from '../../lib/chats';
import { isValidVpa } from '../../lib/upi';
import { Button, Card, Empty, Input } from '../../components/ui';
import { UpiQr } from '../../components/UpiQr';
import { colors } from '../../theme';

export default function FeeSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const chat = useChat(id);
  const [vpa, setVpa] = useState(chat?.upi?.vpa ?? '');
  const [payeeName, setPayeeName] = useState(chat?.upi?.payeeName ?? me.name);
  const [amount, setAmount] = useState(chat?.upi?.amount ? String(chat.upi.amount) : '');
  const [busy, setBusy] = useState(false);

  if (!chat || !chat.admins.includes(me.uid)) return <Empty title="Only group admins can change fee settings" />;

  const save = async () => {
    const amt = Number(amount);
    if (!isValidVpa(vpa)) return Alert.alert('Invalid UPI ID', 'Enter a UPI ID like yourname@okaxis or 9876543210@ybl');
    if (!payeeName.trim()) return Alert.alert('Payee name', 'Enter the name shown on your UPI account.');
    if (!amt || amt <= 0) return Alert.alert('Monthly fee', 'Enter the monthly gym fee in rupees.');
    setBusy(true);
    try {
      await updateDoc(chatRef(chat.id), { upi: { vpa: vpa.trim(), payeeName: payeeName.trim(), amount: amt } });
      await sendMessage(chat.id, me, `${me.name} updated the gym fee: ₹${amt}/month, due on the 1st. Pay from the Fees tab.`, 'system');
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text, marginBottom: 4 }}>Where members pay</Text>
        <Text style={{ color: colors.muted, marginBottom: 14 }}>
          Members tap "Pay now" in the Fees tab, their UPI app opens with your UPI ID and the amount filled in, and once the payment
          succeeds they are marked as paid (green) automatically. Fees are due on the 1st of every month.
        </Text>
        <Input label="Your UPI ID (VPA)" placeholder="gymowner@okaxis" autoCapitalize="none" autoCorrect={false} value={vpa} onChangeText={setVpa} />
        <Input label="Payee name" placeholder="Name on the UPI account" value={payeeName} onChangeText={setPayeeName} />
        <Input label="Monthly fee (₹)" placeholder="800" keyboardType="number-pad" value={amount} onChangeText={setAmount} />
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
