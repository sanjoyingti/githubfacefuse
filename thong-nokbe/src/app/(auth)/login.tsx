import React, { useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { signInWithPhoneNumber, type ConfirmationResult } from '@react-native-firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { normalizePhone, formatPhone } from '../../lib/phone';
import { Button, Input } from '../../components/ui';
import { APP_NAME, colors } from '../../theme';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmation = useRef<ConfirmationResult | null>(null);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [sentTo, setSentTo] = useState('');

  const sendCode = async () => {
    const n = normalizePhone(phone);
    if (!n) return Alert.alert('Invalid number', 'Enter your mobile number, e.g. 9876543210');
    setBusy(true);
    try {
      confirmation.current = await signInWithPhoneNumber(auth, n);
      setSentTo(n);
      setStep('code');
    } catch (e: any) {
      Alert.alert('Could not send code', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!confirmation.current) return;
    setBusy(true);
    try {
      await confirmation.current.confirm(code.trim());
      // AuthProvider takes it from here.
    } catch (e: any) {
      Alert.alert('Wrong code', e?.message ?? 'Please check the 6-digit code and try again.');
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.header }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Ionicons name="barbell" size={56} color="#fff" />
        </View>
        <Text style={styles.title}>{APP_NAME}</Text>
        <Text style={styles.subtitle}>Workouts · Gym groups · Attendance · Fees</Text>
        <View style={styles.card}>
          {step === 'phone' ? (
            <>
              <Text style={styles.h}>Enter your phone number</Text>
              <Text style={styles.p}>We'll send you a 6-digit code by SMS. Your gym friends find you by this number.</Text>
              <Input placeholder="98765 43210" keyboardType="phone-pad" value={phone} onChangeText={setPhone} autoFocus />
              <Button title="Send code" onPress={sendCode} loading={busy} />
            </>
          ) : (
            <>
              <Text style={styles.h}>Verify {formatPhone(sentTo)}</Text>
              <Text style={styles.p}>Enter the 6-digit code we sent you.</Text>
              <Input
                placeholder="123456"
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={setCode}
                autoFocus
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                style={{ letterSpacing: 8, fontSize: 22, textAlign: 'center' }}
              />
              <Button title="Verify" onPress={verify} loading={busy} disabled={code.trim().length < 6} />
              <Button title="Change number" variant="ghost" onPress={() => setStep('phone')} style={{ marginTop: 8 }} />
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logo: { alignSelf: 'center', width: 96, height: 96, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 34, fontWeight: '900', textAlign: 'center', marginTop: 16 },
  subtitle: { color: '#a7f3d0', textAlign: 'center', marginTop: 6, marginBottom: 28 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 20 },
  h: { fontSize: 19, fontWeight: '800', color: colors.text },
  p: { color: colors.muted, marginTop: 6, marginBottom: 16 },
});
