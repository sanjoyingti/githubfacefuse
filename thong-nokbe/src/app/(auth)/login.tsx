import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { signInWithPhoneNumber, type ConfirmationResult } from '@react-native-firebase/auth';
import { auth } from '../../lib/firebase';
import { friendlyAuthError, isServerNotConnected, NOT_CONNECTED_MESSAGE } from '../../lib/authErrors';
import { setPendingName } from '../../lib/registration';
import { normalizePhone, formatPhone } from '../../lib/phone';
import { Button, Input } from '../../components/ui';
import { APP_NAME, colors } from '../../theme';

type Mode = 'choose' | 'register' | 'signin';
const RESEND_SECONDS = 30;

export default function Login() {
  const [mode, setMode] = useState<Mode>('choose');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmation = useRef<ConfirmationResult | null>(null);
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [sentTo, setSentTo] = useState('');
  const [wait, setWait] = useState(0);

  // Countdown before "Resend code" becomes available.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const isRegister = mode === 'register';

  const sendCode = async (resend = false) => {
    if (isRegister && name.trim().length < 2) return Alert.alert('Your name', 'Please type your name.');
    const n = normalizePhone(phone);
    if (!n) return Alert.alert('Phone number', 'Type your mobile number, for example 9876543210.');
    setBusy(true);
    try {
      setPendingName(isRegister ? name : null);
      // Firebase sends the SMS. On many Android phones the code is read automatically.
      confirmation.current = await signInWithPhoneNumber(auth, n);
      setSentTo(n);
      setStep('code');
      setCode('');
      setWait(RESEND_SECONDS);
      if (resend) Alert.alert('Code sent again', `A new code was sent to ${formatPhone(n)}.`);
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
      // AuthProvider activates the account (creates the profile) and opens the app.
    } catch (e: any) {
      Alert.alert(isRegister ? 'Could not activate' : 'Could not sign in', friendlyAuthError(e));
      setBusy(false);
    }
  };

  const back = () => {
    setStep('details');
    setCode('');
    if (step === 'details') setMode('choose');
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
          {mode === 'choose' ? (
            <>
              <Text style={styles.h}>Welcome! 👋</Text>
              <Text style={styles.p}>Are you new here?</Text>
              <Pressable style={[styles.choice, { backgroundColor: colors.primary }]} onPress={() => setMode('register')}>
                <Text style={styles.choiceIcon}>📝</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.choiceTitle}>Register</Text>
                  <Text style={styles.choiceSub}>I am new. Make my account.</Text>
                </View>
              </Pressable>
              <Pressable style={[styles.choice, styles.choiceLight]} onPress={() => setMode('signin')}>
                <Text style={styles.choiceIcon}>🔑</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.choiceTitle, { color: colors.primaryDark }]}>Sign in</Text>
                  <Text style={[styles.choiceSub, { color: colors.muted }]}>I already have an account.</Text>
                </View>
              </Pressable>
            </>
          ) : step === 'details' ? (
            <>
              <Text style={styles.step}>STEP 1 of 2</Text>
              <Text style={styles.h}>{isRegister ? 'Register' : 'Sign in'}</Text>
              <Text style={styles.p}>
                {isRegister
                  ? 'Type your name and phone number. We will send an activation code by SMS to this number.'
                  : 'Type your phone number. We will send you a code by SMS.'}
              </Text>
              {isRegister && <Input label="Your name" placeholder="e.g. Sanjoy Ingti" value={name} onChangeText={setName} autoFocus />}
              <Input label="Phone number" placeholder="98765 43210" keyboardType="phone-pad" value={phone} onChangeText={setPhone} autoFocus={!isRegister} />
              <Button title={isRegister ? 'Send activation code 📩' : 'Send code 📩'} onPress={() => sendCode()} loading={busy} />
              <Button title="⬅ Back" variant="ghost" onPress={back} style={{ marginTop: 8 }} />
            </>
          ) : (
            <>
              <Text style={styles.step}>STEP 2 of 2</Text>
              <Text style={styles.h}>{isRegister ? 'Activate your account' : 'Type the code'}</Text>
              <Text style={styles.p}>We sent a 6-number code by SMS to {formatPhone(sentTo)}.</Text>
              <Input
                placeholder="123456"
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={setCode}
                autoFocus
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                style={{ letterSpacing: 8, fontSize: 24, textAlign: 'center' }}
              />
              <Button title={isRegister ? 'Activate my account ✅' : 'Sign in ✅'} onPress={verify} loading={busy} disabled={code.trim().length < 6} />
              <Button
                title={wait > 0 ? `Resend code in ${wait}s` : 'Resend code 🔁'}
                variant="outline"
                disabled={wait > 0 || busy}
                onPress={() => sendCode(true)}
                style={{ marginTop: 10 }}
              />
              <Button title="⬅ Change number" variant="ghost" onPress={back} style={{ marginTop: 4 }} />
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
  h: { fontSize: 24, fontWeight: '900', color: colors.text },
  step: { color: colors.primary, fontWeight: '900', fontSize: 13, marginBottom: 4 },
  p: { color: colors.muted, marginTop: 6, marginBottom: 16, fontSize: 16 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, padding: 16, marginBottom: 12 },
  choiceLight: { backgroundColor: '#fff', borderWidth: 2, borderColor: colors.primary },
  choiceIcon: { fontSize: 32 },
  choiceTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  choiceSub: { color: '#dcfce7', fontSize: 15, marginTop: 2 },
});
