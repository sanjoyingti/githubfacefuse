import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { findUsersByPhones } from '../lib/users';
import { useContacts, type ContactRow } from '../lib/contacts';
import { formatPhone, normalizePhone } from '../lib/phone';
import type { UserProfile } from '../lib/types';
import { APP_INVITE_LINK } from '../config';
import { APP_NAME, colors } from '../theme';
import { Avatar } from './ui';
import { useBottomInset } from './useBottomInset';

export interface Selection {
  users: UserProfile[]; // registered app users -> added immediately
  phones: string[]; // numbers without the app -> invited, auto-join after installing
}

type Row = ContactRow;

/**
 * WhatsApp-style member picker: shows phone contacts that already use the app first,
 * lets you invite the rest, and lets you type any number manually.
 */
export function MemberPicker({
  meUid,
  excludeUids = [],
  excludePhones = [],
  value,
  onChange,
  single,
}: {
  meUid: string;
  excludeUids?: string[];
  excludePhones?: string[];
  value: Selection;
  onChange: (s: Selection) => void;
  single?: boolean; // for starting a 1:1 chat (registered users only)
}) {
  const { loading, rows, permissionDenied, error } = useContacts();
  const [search, setSearch] = useState('');
  const bottomInset = useBottomInset();
  const [manual, setManual] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  useEffect(() => {
    if (error) Alert.alert('Could not read contacts', error);
  }, [error]);

  const excluded = (r: Row) => (r.user ? r.user.uid === meUid || excludeUids.includes(r.user.uid) : excludePhones.includes(r.phone));
  const isSelected = (r: Row) => (r.user ? value.users.some((u) => u.uid === r.user!.uid) : value.phones.includes(r.phone));

  const toggle = (r: Row) => {
    if (r.user) {
      const u = r.user;
      if (single) return onChange({ users: [u], phones: [] });
      const has = value.users.some((x) => x.uid === u.uid);
      onChange({ ...value, users: has ? value.users.filter((x) => x.uid !== u.uid) : [...value.users, u] });
    } else {
      if (single) return invite(r);
      const has = value.phones.includes(r.phone);
      onChange({ ...value, phones: has ? value.phones.filter((p) => p !== r.phone) : [...value.phones, r.phone] });
    }
  };

  const invite = (r: { name: string; phone: string }) =>
    Share.share({ message: `Hi ${r.name}! Join me on ${APP_NAME} — our gym app for workouts, chat, attendance and fees: ${APP_INVITE_LINK}` });

  const addManual = async () => {
    const n = normalizePhone(manual);
    if (!n) return Alert.alert('Invalid number', 'Enter a mobile number like 9876543210 or +919876543210.');
    setManualBusy(true);
    try {
      const found = (await findUsersByPhones([n]))[n];
      if (found?.uid === meUid) return Alert.alert("That's you", 'You are already in the group.');
      const row: Row = { key: `manual-${n}`, name: found?.name ?? formatPhone(n), phone: n, user: found };
      if (excluded(row)) return Alert.alert('Already added', `${row.name} is already in this group.`);
      if (!found && single) {
        Alert.alert('Not on ' + APP_NAME, `${formatPhone(n)} hasn't installed the app yet. Send them an invite?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Invite', onPress: () => invite(row) },
        ]);
        return;
      }
      if (!isSelected(row)) toggle(row);
      if (!found) Alert.alert('Invite sent to group list', `${formatPhone(n)} isn't on ${APP_NAME} yet. They'll join the group automatically once they install the app and sign in with this number.`);
      setManual('');
    } finally {
      setManualBusy(false);
    }
  };

  const excludeKey = excludeUids.join() + '|' + excludePhones.join();
  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => !excluded(r) && (!q || r.name.toLowerCase().includes(q) || r.phone.includes(q.replace(/\s/g, ''))));
    const onApp = filtered.filter((r) => r.user);
    const off = filtered.filter((r) => !r.user);
    return [
      { title: `Contacts on ${APP_NAME}`, data: onApp },
      { title: single ? 'Invite to ' + APP_NAME : 'Not on the app yet (they will be invited)', data: off },
    ].filter((s) => s.data.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, excludeKey]);

  const selectedCount = value.users.length + value.phones.length;
  const manualSelected = [
    ...value.users.filter((u) => !rows.some((r) => r.user?.uid === u.uid)).map((u) => ({ label: u.name, key: u.uid })),
    ...value.phones.filter((p) => !rows.some((r) => r.phone === p)).map((p) => ({ label: formatPhone(p), key: p })),
  ];

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.manualRow}>
        <Ionicons name="call-outline" size={20} color={colors.muted} />
        <TextInput
          style={styles.manualInput}
          placeholder="Add by phone number"
          keyboardType="phone-pad"
          value={manual}
          onChangeText={setManual}
          onSubmitEditing={addManual}
          placeholderTextColor={colors.muted}
        />
        <Pressable onPress={addManual} style={styles.addBtn} disabled={manualBusy}>
          {manualBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Add</Text>}
        </Pressable>
      </View>
      {manualSelected.length > 0 && (
        <View style={styles.chips}>
          {manualSelected.map((m) => (
            <Pressable
              key={m.key}
              style={styles.chip}
              onPress={() => onChange({ users: value.users.filter((u) => u.uid !== m.key), phones: value.phones.filter((p) => p !== m.key) })}
            >
              <Text style={{ color: colors.primaryDark, fontWeight: '600' }}>{m.label}</Text>
              <Ionicons name="close-circle" size={16} color={colors.primaryDark} />
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput style={styles.search} placeholder="Search contacts" value={search} onChangeText={setSearch} placeholderTextColor={colors.muted} />
        {!single && selectedCount > 0 && <Text style={{ color: colors.primary, fontWeight: '700' }}>{selectedCount} selected</Text>}
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} />
      ) : permissionDenied ? (
        <Text style={styles.note}>Contacts permission was denied. You can still add members by typing their phone number above.</Text>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: single ? bottomInset : 0 }}
          renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
          ListEmptyComponent={<Text style={styles.note}>No matching contacts.</Text>}
          renderItem={({ item }) => {
            const sel = isSelected(item);
            return (
              <Pressable style={styles.row} onPress={() => toggle(item)}>
                <Avatar name={item.user?.name ?? item.name} size={42} color={item.user ? undefined : '#94A3B8'} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.rowName}>{item.name}</Text>
                  <Text style={styles.rowSub}>{item.user ? item.user.about || formatPhone(item.phone) : formatPhone(item.phone)}</Text>
                </View>
                {item.user || !single ? (
                  <Ionicons name={sel ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={sel ? colors.primary : colors.border} />
                ) : (
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>INVITE</Text>
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  manualRow: { flexDirection: 'row', alignItems: 'center', margin: 12, backgroundColor: colors.card, borderRadius: 12, paddingLeft: 12, borderWidth: 1, borderColor: colors.border },
  manualInput: { flex: 1, height: 46, fontSize: 16, marginLeft: 8, color: colors.text },
  addBtn: { backgroundColor: colors.primary, height: 46, paddingHorizontal: 18, justifyContent: 'center', borderTopRightRadius: 12, borderBottomRightRadius: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginBottom: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.paidBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 4, gap: 8 },
  search: { flex: 1, height: 40, fontSize: 15, color: colors.text },
  section: { backgroundColor: colors.bg, paddingHorizontal: 16, paddingVertical: 6, color: colors.muted, fontWeight: '700', fontSize: 12, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.card },
  rowName: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowSub: { color: colors.muted, marginTop: 2, fontSize: 13 },
  note: { color: colors.muted, textAlign: 'center', padding: 24 },
});
