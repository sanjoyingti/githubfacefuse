import React, { useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { buildUpiUrl } from '../lib/upi';
import type { UpiSettings } from '../lib/types';
import { colors } from '../theme';

type QrRef = { toDataURL: (cb: (base64: string) => void) => void } | null;

/**
 * UPI payment QR drawn inside the app from the admin's UPI ID: scan it with any UPI app (GPay, PhonePe, Paytm…).
 * With `shareable`, a button sends the QR image to a UPI app on THIS phone, which reads it and opens the payment —
 * the same safe "scan & pay" route UPI apps always accept.
 */
export function UpiQr({ upi, size = 190, shareable }: { upi: UpiSettings; size?: number; shareable?: boolean }) {
  const url = buildUpiUrl(upi, { note: 'Gym fee' });
  const qr = useRef<QrRef>(null);
  const [busy, setBusy] = useState(false);

  const share = () => {
    if (!qr.current) return;
    setBusy(true);
    qr.current.toDataURL(async (base64) => {
      try {
        const path = `${FileSystem.cacheDirectory}upi-qr.png`;
        await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
        if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
        await Sharing.shareAsync(path, { mimeType: 'image/png', dialogTitle: 'Pay with your UPI app' });
      } catch (e: any) {
        Alert.alert('Could not share the QR', e?.message ?? String(e));
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ alignSelf: 'center', padding: 12, backgroundColor: '#fff', borderRadius: 16, marginTop: 12 }}>
        <QRCode value={url} size={size} getRef={(c: QrRef) => (qr.current = c)} quietZone={8} />
      </View>
      {shareable && (
        <Pressable
          onPress={share}
          disabled={busy}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 16, height: 46, borderRadius: 23, borderWidth: 2, borderColor: colors.primary }}
        >
          <Ionicons name="qr-code" size={18} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: '800' }}>{busy ? 'Preparing…' : 'Pay by QR from this phone'}</Text>
        </Pressable>
      )}
    </View>
  );
}
