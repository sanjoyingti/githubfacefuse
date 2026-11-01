import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMe } from '../../context/AuthProvider';
import { useChats } from '../../context/ChatsProvider';
import { GroupSwitcher, NoGroups } from '../../components/GroupSwitcher';
import { Avatar, Button, Card, Loading } from '../../components/ui';
import { markAttendance, useMonthAttendance } from '../../lib/attendance';
import { addDays, dayKey, daysInMonth, formatDayLong, formatMonth, parseDayKey } from '../../lib/dates';
import { displayName, useUsers } from '../../lib/users';
import { colors } from '../../theme';
import type { AttendanceStatus, UserProfile } from '../../lib/types';

export default function Attendance() {
  const me = useMe();
  const { selectedGroup: group, loading } = useChats();
  const [date, setDate] = useState(dayKey());
  const month = date.slice(0, 7);
  const { days } = useMonthAttendance(group?.id, month);
  const users = useUsers(group?.members ?? []);
  const [historyFor, setHistoryFor] = useState<UserProfile | null>(null);

  const members = useMemo(
    () => (group?.members ?? []).map((uid) => users[uid] ?? ({ uid, name: '…', phone: '' } as UserProfile)).sort((a, b) => a.name.localeCompare(b.name)),
    [group?.members, users],
  );

  if (loading) return <Loading />;
  if (!group) return <NoGroups />;

  const isAdmin = group.admins.includes(me.uid);
  const today = days[date] ?? {};
  const isFuture = date > dayKey();
  const presentCount = Object.values(today).filter((s) => s === 'present').length;
  const absentCount = Object.values(today).filter((s) => s === 'absent').length;

  const mark = (uid: string, s: AttendanceStatus) => {
    const next = today[uid] === s ? null : s; // tap again to clear
    markAttendance(group.id, date, me.uid, { [uid]: next }).catch((e) => Alert.alert('Could not save', e?.message ?? String(e)));
  };

  const markAllUnmarked = (s: AttendanceStatus) => {
    const marks: Record<string, AttendanceStatus> = {};
    members.forEach((m) => !today[m.uid] && (marks[m.uid] = s));
    if (!Object.keys(marks).length) return;
    markAttendance(group.id, date, me.uid, marks).catch((e) => Alert.alert('Could not save', e?.message ?? String(e)));
  };

  const monthStats = (uid: string) => {
    let p = 0,
      a = 0;
    for (const recs of Object.values(days)) {
      if (recs[uid] === 'present') p++;
      else if (recs[uid] === 'absent') a++;
    }
    return { p, a };
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <GroupSwitcher />
      <View style={styles.dateBar}>
        <Pressable onPress={() => setDate(dayKey(addDays(parseDayKey(date), -1)))} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.dateText}>{formatDayLong(parseDayKey(date))}</Text>
          {date === dayKey() && <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>TODAY</Text>}
        </View>
        <Pressable onPress={() => setDate(dayKey(addDays(parseDayKey(date), 1)))} hitSlop={12} disabled={date >= dayKey()}>
          <Ionicons name="chevron-forward" size={26} color={date >= dayKey() ? colors.border : colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={styles.summary}>
          <Stat n={presentCount} label="Present" color={colors.paid} />
          <Stat n={absentCount} label="Absent" color={colors.unpaid} />
          <Stat n={members.length - presentCount - absentCount} label="Not marked" color={colors.muted} />
        </View>
        {isAdmin ? (
          !isFuture && (
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <Button small title="Mark rest present" variant="outline" onPress={() => markAllUnmarked('present')} style={{ flex: 1 }} />
              <Button small title="Mark rest absent" variant="outline" onPress={() => markAllUnmarked('absent')} style={{ flex: 1 }} />
            </View>
          )
        ) : (
          <Text style={styles.note}>Only group admins can mark attendance. Everyone in the group can view it.</Text>
        )}
        <Card style={{ padding: 0 }}>
          {members.map((m, i) => {
            const s = today[m.uid];
            const st = monthStats(m.uid);
            return (
              <View key={m.uid} style={[styles.row, i > 0 && styles.rowBorder]}>
                <Pressable style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => setHistoryFor(m)}>
                  <Avatar name={m.name} size={40} />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {m.uid === me.uid ? `${displayName(m)} (You)` : displayName(m)}
                    </Text>
                    <Text style={styles.sub}>
                      {formatMonth(parseDayKey(date))}: {st.p} present · {st.a} absent
                    </Text>
                  </View>
                </Pressable>
                {isAdmin && !isFuture ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Toggle label="P" active={s === 'present'} color={colors.paid} onPress={() => mark(m.uid, 'present')} />
                    <Toggle label="A" active={s === 'absent'} color={colors.unpaid} onPress={() => mark(m.uid, 'absent')} />
                  </View>
                ) : (
                  <StatusTag s={s} />
                )}
              </View>
            );
          })}
        </Card>
      </ScrollView>
      <HistoryModal user={historyFor} month={month} days={days} onClose={() => setHistoryFor(null)} />
    </View>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 26, fontWeight: '900', color }}>{n}</Text>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

function Toggle({ label, active, color, onPress }: { label: string; active: boolean; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.toggle, { borderColor: color, backgroundColor: active ? color : '#fff' }]}>
      <Text style={{ color: active ? '#fff' : color, fontWeight: '900' }}>{label}</Text>
    </Pressable>
  );
}

function StatusTag({ s }: { s?: AttendanceStatus }) {
  if (!s) return <Text style={{ color: colors.muted, fontSize: 12 }}>Not marked</Text>;
  const present = s === 'present';
  return (
    <View style={{ backgroundColor: present ? colors.paidBg : colors.unpaidBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 }}>
      <Text style={{ color: present ? colors.paid : colors.unpaid, fontWeight: '800', fontSize: 12 }}>{present ? 'Present' : 'Absent'}</Text>
    </View>
  );
}

function HistoryModal({
  user,
  month,
  days,
  onClose,
}: {
  user: UserProfile | null;
  month: string;
  days: Record<string, Record<string, AttendanceStatus>>;
  onClose: () => void;
}) {
  if (!user) return null;
  const first = parseDayKey(`${month}-01`);
  const n = daysInMonth(first);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
  let p = 0,
    a = 0;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{user.name}</Text>
          <Text style={{ color: colors.muted, marginBottom: 12 }}>{formatMonth(first)} attendance</Text>
          <View style={styles.grid}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <Text key={i} style={[styles.cell, { color: colors.muted, fontWeight: '700' }]}>
                {d}
              </Text>
            ))}
            {cells.map((d, i) => {
              if (!d) return <View key={i} style={styles.cell} />;
              const key = `${month}-${String(d).padStart(2, '0')}`;
              const s = days[key]?.[user.uid];
              if (s === 'present') p++;
              if (s === 'absent') a++;
              return (
                <View key={i} style={[styles.cell, styles.dayCell, s === 'present' && { backgroundColor: colors.paid }, s === 'absent' && { backgroundColor: colors.unpaid }]}>
                  <Text style={{ color: s ? '#fff' : colors.text, fontWeight: '700' }}>{d}</Text>
                </View>
              );
            })}
          </View>
          <Text style={{ marginTop: 12, color: colors.text, fontWeight: '700' }}>
            🟢 {p} present · 🔴 {a} absent{p + a ? ` · ${Math.round((p / (p + a)) * 100)}% attendance` : ''}
          </Text>
          <Button title="Close" variant="ghost" onPress={onClose} style={{ marginTop: 8 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dateBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10 },
  dateText: { fontWeight: '800', color: colors.text, fontSize: 15 },
  summary: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, paddingVertical: 14, marginBottom: 12 },
  note: { color: colors.muted, marginBottom: 12, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  name: { fontWeight: '700', color: colors.text, fontSize: 15 },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  toggle: { width: 40, height: 40, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', textAlign: 'center', textAlignVertical: 'center' },
  dayCell: { borderRadius: 10, borderWidth: 2, borderColor: '#fff', backgroundColor: '#F1F5F9' },
});
