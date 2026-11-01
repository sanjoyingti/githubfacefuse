import React from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { buildUpiUrl } from '../lib/upi';
import type { UpiSettings } from '../lib/types';

/** UPI payment QR drawn inside the app from the admin's UPI ID: scan it with any UPI app (GPay, PhonePe, Paytm…). */
export function UpiQr({ upi, size = 190 }: { upi: UpiSettings; size?: number }) {
  const url = buildUpiUrl(upi, { note: 'Gym fee', ref: 'TNQR' });
  return (
    <View style={{ alignSelf: 'center', padding: 12, backgroundColor: '#fff', borderRadius: 16, marginTop: 12 }}>
      <QRCode value={url} size={size} />
    </View>
  );
}
