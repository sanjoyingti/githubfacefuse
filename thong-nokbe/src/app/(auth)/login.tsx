import React, { useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { signInWithPhoneNumber, type ConfirmationResult } from '@react-native-firebase/auth';
import { auth } from '../../lib/firebase';
import { friendlyAuthError, isServerNotConnected, NOT_CONNECTED_MESSAGE } from '../../lib/authErrors';
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
      Alert.alert('Could not send code', friendlyAuthError(e));
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
      Alert.alert('Could not sign in', friendlyAuthError(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.header }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Image source={require('../../../assets/logo.png')} style={styles.logo} />
        <Text style={styles.title}>{APP_NAME}</Text>
        <Text style={styles.subtitle}>🏋️ Exercise · 💬 Chat · 📞 Call · ✅ Attendance · 💰 Fees</Text>
        {isServerNotConnected() && (
          <View style={styles.warn}>
            <Text style={styles.warnTitle}>⚠️ Setup not finished</Text>
            <Text style={styles.warnText}>{NOT_CONNECTED_MESSAGE}</Text>
          </View>
        )}
        <View style={styles.card}>
          {step === 'phone' ? (
            <>
              <Text style={styles.step}>STEP 1 of 2</Text>
              <Text style={styles.h}>Type your phone number</Text>
              <Text style={styles.p}>We will send you a secret code by SMS.</Text>
              <Input placeholder="98765 43210" keyboardType="phone-pad" value={phone} onChangeText={setPhone} autoFocus />
              <Button title="Next ➜" onPress={sendCode} loading={busy} />
            </>
          ) : (
            <>
              <Text style={styles.step}>STEP 2 of 2</Text>
              <Text style={styles.h}>Type the code</Text>
              <Text style={styles.p}>We sent a 6-number code to {formatPhone(sentTo)}.</Text>
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
              <Button title="Let's go! 💪" onPress={verify} loading={busy} disabled={code.trim().length < 6} />
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
  logo: { alignSelf: 'center', width: 150, height: 150 },
  title: { color: '#fff', fontSize: 32, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  subtitle: { color: '#a7f3d0', textAlign: 'center', marginTop: 6, marginBottom: 28, fontSize: 15, lineHeight: 22 },
  warn: { backgroundColor: '#FEF3C7', borderRadius: 16, padding: 14, marginBottom: 14 },
  warnTitle: { fontWeight: '900', fontSize: 16, color: '#92400E' },
  warnText: { color: '#92400E', marginTop: 4, fontSize: 15 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 20 },
  h: { fontSize: 22, fontWeight: '900', color: colors.text },
  step: { color: colors.primary, fontWeight: '900', fontSize: 13, marginBottom: 4 },
  p: { color: colors.muted, marginTop: 6, marginBottom: 16, fontSize: 16 },
});
