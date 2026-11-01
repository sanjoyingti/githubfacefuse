import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useAuth, useMe } from '../context/AuthProvider';
import { useChats } from '../context/ChatsProvider';
import { Avatar, Button, Card, Input } from '../components/ui';
import { formatPhone } from '../lib/phone';
import { APP_NAME, colors } from '../theme';
import { useBottomInset } from '../components/useBottomInset';

export default function Profile() {
  const me = useMe();
  const bottomInset = useBottomInset();
  const { updateProfileInfo, logout } = useAuth();
  const { groups } = useChats();
  const [name, setName] = useState(me.name);
  const [about, setAbout] = useState(me.about ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== me.name || about.trim() !== (me.about ?? '');

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + bottomInset }} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: 'center', marginVertical: 16 }}>
        <Avatar name={me.name} size={96} />
        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 10 }}>{me.name}</Text>
        <Text style={{ color: colors.muted }}>{formatPhone(me.phone)}</Text>
      </View>
      <Card>
        <Input label="Name" value={name} onChangeText={setName} />
        <Input label="About" placeholder="e.g. Chasing a 100kg bench 💪" value={about} onChangeText={setAbout} />
        <Button
          title="Save"
          disabled={!dirty || name.trim().length < 2}
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await updateProfileInfo(name, about);
            } catch (e: any) {
              Alert.alert('Could not save', e?.message ?? String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
      <Card>
        <Text style={{ fontWeight: '800', color: colors.text, marginBottom: 6 }}>My gym groups</Text>
        {groups.length ? (
          groups.map((g) => (
            <Text key={g.id} style={{ color: colors.text, paddingVertical: 4 }}>
              • {g.name} {g.admins.includes(me.uid) ? '(admin)' : ''}
            </Text>
          ))
        ) : (
          <Text style={{ color: colors.muted }}>None yet</Text>
        )}
      </Card>
      <Button
        title="Log out"
        variant="danger"
        onPress={() =>
          Alert.alert('Log out?', `You can sign back in to ${APP_NAME} with the same phone number.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log out', style: 'destructive', onPress: logout },
          ])
        }
      />
      <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 20, fontSize: 12 }}>{APP_NAME} v1.0.0</Text>
    </ScrollView>
  );
}
