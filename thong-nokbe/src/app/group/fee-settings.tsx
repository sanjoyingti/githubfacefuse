import React, { useState } from 'react';
import { Alert, Image, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { updateDoc } from '@react-native-firebase/firestore';
import { getDownloadURL, putFile, ref } from '@react-native-firebase/storage';
import { useMe } from '../../context/AuthProvider';
import { useChat } from '../../context/ChatsProvider';
import { chatRef, sendMessage } from '../../lib/chats';
import { storage } from '../../lib/firebase';
import { isValidVpa } from '../../lib/upi';
import { Button, Card, Empty, Input } from '../../components/ui';
import { colors } from '../../theme';

export default function FeeSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const chat = useChat(id);
  const [vpa, setVpa] = useState(chat?.upi?.vpa ?? '');
  const [payeeName, setPayeeName] = useState(chat?.upi?.payeeName ?? me.name);
  const [amount, setAmount] = useState(chat?.upi?.amount ? String(chat.upi.amount) : '');
  const [qrUrl, setQrUrl] = useState<string | null>(chat?.upi?.qrUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  if (!chat || !chat.admins.includes(me.uid)) return <Empty title="Only group admins can change fee settings" />;

  const pickQr = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets[0]) return;
    setUploading(true);
    try {
      const r = ref(storage, `groups/${chat.id}/upi-qr-${Date.now()}.jpg`);
      await putFile(r, res.assets[0].uri);
      setQrUrl(await getDownloadURL(r));
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? String(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const amt = Number(amount);
    if (!isValidVpa(vpa)) return Alert.alert('Invalid UPI ID', 'Enter a UPI ID like yourname@okaxis or 9876543210@ybl');
    if (!payeeName.trim()) return Alert.alert('Payee name', 'Enter the name shown on your UPI account.');
    if (!amt || amt <= 0) return Alert.alert('Monthly fee', 'Enter the monthly gym fee in rupees.');
    setBusy(true);
    try {
      await updateDoc(chatRef(chat.id), { upi: { vpa: vpa.trim(), payeeName: payeeName.trim(), amount: amt, qrUrl } });
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
      <Card>
        <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text, marginBottom: 4 }}>UPI QR code (optional)</Text>
        <Text style={{ color: colors.muted, marginBottom: 12 }}>Upload a screenshot of your UPI QR so members can also scan it from another phone.</Text>
        {qrUrl ? <Image source={{ uri: qrUrl }} style={{ width: 200, height: 200, alignSelf: 'center', marginBottom: 12, borderRadius: 12 }} /> : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title={qrUrl ? 'Change QR' : 'Upload QR'} variant="outline" onPress={pickQr} loading={uploading} style={{ flex: 1 }} />
          {qrUrl ? <Button title="Remove" variant="ghost" onPress={() => setQrUrl(null)} /> : null}
        </View>
      </Card>
      <Button title="Save" onPress={save} loading={busy} />
    </ScrollView>
  );
}
