import React, { useState } from 'react';
import { Alert, Linking, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { setSharing, useSharingOn } from '../lib/liveLocation';
import { BackgroundLocationTips } from '../components/BackgroundLocationTips';
import { useAuth, useMe } from '../context/AuthProvider';
import { useChats } from '../context/ChatsProvider';
import { Avatar, Button, Card, Input } from '../components/ui';
import { formatPhone } from '../lib/phone';
import { APP_NAME, colors } from '../theme';
import { useBottomInset } from '../components/useBottomInset';
import { APP_VERSION, BUILD_NUMBER, fetchLatestUpdate, requestUpdateCheck } from '../lib/appUpdate';

export default function Profile() {
  const me = useMe();
  const bottomInset = useBottomInset();
  const { updateProfileInfo, logout } = useAuth();
  const { groups } = useChats();
  const [name, setName] = useState(me.name);
  const [about, setAbout] = useState(me.about ?? '');
  const [checking, setChecking] = useState(false);
  const sharing = useSharingOn();
  const [sharingBusy, setSharingBusy] = useState(false);
  const toggleSharing = async (on: boolean) => {
    setSharingBusy(true);
    const r = await setSharing(on, me.name);
    setSharingBusy(false);
    if (r === 'denied')
      Alert.alert('Location is not allowed', 'Allow location for Thong Nokbe Gym in the phone settings, then turn this on again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
    else if (r === 'on-while-open')
      Alert.alert('Sharing while the app is open', 'To be seen even when the app is closed, set Location to "Allow all the time" for Thong Nokbe Gym in the phone settings.', [
        { text: 'OK', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
  };
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
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text }}>📍 Share my live location</Text>
            <Text style={{ color: colors.muted, marginTop: 4 }}>
              {sharing ? 'ON — members of your groups see you on the group map.' : 'OFF — nobody can see where you are.'}
            </Text>
          </View>
          <Switch value={sharing} onValueChange={toggleSharing} disabled={sharingBusy} trackColor={{ true: colors.primary }} />
        </View>
        {sharing && <BackgroundLocationTips myName={me.name} />}
        <Button title="🔐 Permissions" variant="outline" onPress={() => router.push('/permissions')} style={{ marginTop: 12 }} />
      </Card>
      <Card>
        <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text }}>📲 App version</Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>You have version {APP_VERSION}</Text>
        <Button
          title={checking ? 'Checking…' : 'Check for updates'}
          variant="outline"
          disabled={checking}
          onPress={async () => {
            setChecking(true);
            const u = await fetchLatestUpdate();
            setChecking(false);
            if (u && BUILD_NUMBER && u.build > BUILD_NUMBER) requestUpdateCheck(); // opens the update box
            else Alert.alert('✅ No new version', u ? `You have the newest version (build ${BUILD_NUMBER || u.build}).` : 'No update has been sent yet. (Or check your internet.)');
          }}
        />
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
      <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 20, fontSize: 12 }}>{APP_NAME} v{APP_VERSION}</Text>
    </ScrollView>
  );
}
