import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { PhoneTakenError, useAuth } from '../../context/AuthProvider';
import { Button, Input } from '../../components/ui';
import { formatPhone, normalizePhone } from '../../lib/phone';
import { APP_NAME, colors } from '../../theme';

/** One-time registration after the first Google sign-in: name + phone number. */
export default function Register() {
  const { user, register, logout } = useAuth();
  const [name, setName] = useState(user?.displayName ?? '');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (name.trim().length < 2) return Alert.alert('Your name', 'Please type your name so gym members know you.');
    const n = normalizePhone(phone);
    if (!n) return Alert.alert('Phone number', 'Type your mobile number, for example 9876543210.');
    setBusy(true);
    try {
      await register(name, n);
      Alert.alert('✅ Account activated!', `Welcome to ${APP_NAME}, ${name.trim()}! 💪\n\nAsk your gym admin to add ${formatPhone(n)} to the gym group.`);
    } catch (e: any) {
      Alert.alert(e instanceof PhoneTakenError ? 'Number already used' : 'Could not register', e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 26, fontWeight: '900', color: colors.text }}>Almost done! 💪</Text>
      <Text style={{ color: colors.muted, marginTop: 6, marginBottom: 20, fontSize: 16 }}>
        Signed in as {user?.email}. Type your name and phone number. Your gym friends find you by this number.
      </Text>
      <Input label="Your name" placeholder="e.g. Sanjoy Ingti" value={name} onChangeText={setName} />
      <Input label="Your phone number" placeholder="98765 43210" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <Button title="Activate my account ✅" onPress={save} loading={busy} />
      <View style={{ height: 8 }} />
      <Button title="Use a different Google account" variant="ghost" onPress={logout} />
    </ScrollView>
  );
}
