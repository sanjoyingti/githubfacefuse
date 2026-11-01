import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRangeAttendance } from '../lib/attendance';
import { addDays, addMonths, dayKey, daysInMonth, formatMonth, formatShort, monthKey, startOfWeek } from '../lib/dates';
import { displayName } from '../lib/users';
import { colors } from '../theme';
import type { UserProfile } from '../lib/types';
import { Avatar } from './ui';
import { useBottomInset } from './useBottomInset';

/**
 * Everyone in the group can see how many days each member came to the gym, for a week or a month.
 * Members are ranked by days present.
 */
export function AttendanceSummary({
  chatId,
  members,
  meUid,
  period,
  onPick,
}: {
  chatId: string;
  members: UserProfile[];
  meUid: string;
  period: 'week' | 'month';
  onPick: (member: UserProfile, month: string) => void;
}) {
  const bottomInset = useBottomInset();
  const [anchor, setAnchor] = useState(() => new Date());

  const { start, end, label, isCurrent } = useMemo(() => {
    if (period === 'week') {
      const s = startOfWeek(anchor);
      const e = addDays(s, 6);
      return { start: dayKey(s), end: dayKey(e), label: `${formatShort(s)} – ${formatShort(e)}`, isCurrent: dayKey(s) === dayKey(startOfWeek(new Date())) };
    }
    const s = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const e = new Date(anchor.getFullYear(), anchor.getMonth(), daysInMonth(s));
    return { start: dayKey(s), end: dayKey(e), label: formatMonth(s), isCurrent: monthKey(s) === monthKey(new Date()) };
  }, [anchor, period]);

  const { days } = useRangeAttendance(chatId, start, end);
  const markedDays = Object.keys(days).length;

  const rows = useMemo(() => {
    return members
      .map((m) => {
        let came = 0,
          away = 0;
        for (const recs of Object.values(days)) {
          if (recs[m.uid] === 'present') came++;
          else if (recs[m.uid] === 'absent') away++;
        }
        return { m, came, away };
      })
      .sort((a, b) => b.came - a.came || a.away - b.away || a.m.name.localeCompare(b.m.name));
  }, [members, days]);

  const move = (dir: -1 | 1) => setAnchor((a) => (period === 'week' ? addDays(a, 7 * dir) : addMonths(a, dir)));
  const medal = ['🥇', '🥈', '🥉'];

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bar}>
        <Pressable onPress={() => move(-1)} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.barText}>{label}</Text>
          {isCurrent && <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>{period === 'week' ? 'THIS WEEK' : 'THIS MONTH'}</Text>}
        </View>
        <Pressable onPress={() => move(1)} hitSlop={12} disabled={isCurrent}>
          <Ionicons name="chevron-forward" size={26} color={isCurrent ? colors.border : colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + bottomInset }}>
        <Text style={styles.note}>
          🏋️ Days each member came to the gym · {markedDays} day{markedDays === 1 ? '' : 's'} marked. Tap a name to see their calendar.
        </Text>
        {rows.map(({ m, came, away }, i) => {
          const total = came + away;
          const pct = total ? Math.round((came / total) * 100) : 0;
          return (
            <Pressable key={m.uid} style={styles.row} onPress={() => onPick(m, start.slice(0, 7))}>
              <Text style={styles.rank}>{came > 0 && i < 3 ? medal[i] : `${i + 1}`}</Text>
              <Avatar name={m.name} size={40} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {m.uid === meUid ? `${displayName(m)} (You)` : displayName(m)}
                </Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.sub}>
                  ✓ {came} came · ✗ {away} away{total ? ` · ${pct}%` : ''}
                </Text>
              </View>
              <View style={styles.bigCount}>
                <Text style={styles.bigNum}>{came}</Text>
                <Text style={styles.bigLabel}>days</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10 },
  barText: { fontWeight: '900', color: colors.text, fontSize: 17 },
  note: { color: colors.muted, marginBottom: 12, fontSize: 14, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 12, marginBottom: 8 },
  rank: { width: 30, fontSize: 18, fontWeight: '900', color: colors.muted, textAlign: 'center' },
  name: { fontWeight: '800', color: colors.text, fontSize: 16 },
  track: { height: 8, backgroundColor: colors.unpaidBg, borderRadius: 4, marginTop: 6, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.paid, borderRadius: 4 },
  sub: { color: colors.muted, fontSize: 13, marginTop: 4 },
  bigCount: { alignItems: 'center', marginLeft: 10, minWidth: 48 },
  bigNum: { fontSize: 26, fontWeight: '900', color: colors.paid },
  bigLabel: { fontSize: 12, color: colors.muted, fontWeight: '700' },
});
