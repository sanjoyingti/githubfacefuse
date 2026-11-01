import React, { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { useAuth } from '../../context/AuthProvider';
import { Button, Input } from '../../components/ui';
import { formatPhone } from '../../lib/phone';
import { colors } from '../../theme';

export default function ProfileSetup() {
  const { user, saveProfile, logout } = useAuth();
  const [name, setName] = useState(user?.displayName ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (name.trim().length < 2) return Alert.alert('Name required', 'Please enter your name so gym members recognise you.');
    setBusy(true);
    try {
      await saveProfile(name);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>Welcome! 💪</Text>
      <Text style={{ color: colors.muted, marginTop: 6, marginBottom: 20 }}>
        Signed in as {formatPhone(user?.phoneNumber ?? '')}. Tell your gym mates who you are.
      </Text>
      <Input label="Your name" placeholder="e.g. Sanjoy Ingti" value={name} onChangeText={setName} autoFocus />
      <Button title="Continue" onPress={save} loading={busy} />
      <Button title="Use a different number" variant="ghost" onPress={logout} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}
