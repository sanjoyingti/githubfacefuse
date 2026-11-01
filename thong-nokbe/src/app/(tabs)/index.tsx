import React, { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { DAY_EMOJI, WORKOUT_DAYS, exerciseOfTheDay, getWorkoutDay, todayKey, type Exercise, type WorkoutDayKey } from '../../data/workouts';
import { useDoneToday } from '../../lib/workoutProgress';
import { formatDayLong } from '../../lib/dates';
import { colors } from '../../theme';

const thumb = (id: string | null) => (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : undefined);

export default function Workouts() {
  const today = todayKey();
  const isRestDay = today === 'sunday';
  const [selected, setSelected] = useState<WorkoutDayKey>(isRestDay ? 'monday' : (today as WorkoutDayKey));
  const done = useDoneToday();
  const open = (e: Exercise) => router.push({ pathname: '/play', params: { day: e.day, i: String(Number(e.id.split('-')[1])) } });
  const day = getWorkoutDay(selected)!;
  const featured = useMemo(() => (isRestDay ? null : exerciseOfTheDay(getWorkoutDay(today)!)), [today, isRestDay]);

  const header = (
    <View>
      <Text style={styles.date}>{formatDayLong(new Date())}</Text>
      {isRestDay ? (
        <View style={[styles.hero, { backgroundColor: '#334155' }]}>
          <Ionicons name="bed" size={28} color="#fff" />
          <Text style={styles.heroTitle}>Sunday is rest day 😴</Text>
          <Text style={styles.heroSub}>No gym today. Rest, drink water, and get ready for Monday!</Text>
        </View>
      ) : (
        featured && (
          <Pressable style={styles.hero} onPress={() => open(featured)}>
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>NEW TODAY</Text>
            </View>
            <Text style={styles.heroLabel}>⭐ Today's new exercise · {getWorkoutDay(today)!.title}</Text>
            <View style={styles.heroThumbWrap}>
              {featured.videoId && <Image source={{ uri: thumb(featured.videoId) }} style={styles.heroThumb} />}
              <View style={styles.playBig}>
                <Ionicons name="play" size={34} color="#fff" />
              </View>
            </View>
            <Text style={styles.heroTitle}>{featured.name}</Text>
          </Pressable>
        )
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
        {WORKOUT_DAYS.map((d) => {
          const active = d.key === selected;
          return (
            <Pressable key={d.key} onPress={() => setSelected(d.key)} style={[styles.dayPill, active && styles.dayPillActive]}>
              <Text style={{ fontSize: 26 }}>{DAY_EMOJI[d.key]}</Text>
              <Text style={[styles.dayShort, active && { color: '#fff' }]}>{d.key === today ? 'Today' : d.short}</Text>
              <Text style={[styles.dayMuscle, active && { color: '#dcfce7' }]}>{d.muscle}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.sectionTitle}>
        {DAY_EMOJI[day.key]} {day.label}: {day.title}
      </Text>
      <Text style={styles.sectionSub}>Tap any exercise to watch how to do it, right here in the app</Text>
      {selected === today && (
        <View style={styles.progressCard}>
          <Text style={styles.progressText}>
            ✅ {day.exercises.filter((e) => done.has(e.id)).length} of {day.exercises.length} done today
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(day.exercises.filter((e) => done.has(e.id)).length / day.exercises.length) * 100}%` }]} />
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={day.exercises}
        keyExtractor={(e) => e.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        renderItem={({ item, index }) => (
          <Pressable style={[styles.row, done.has(item.id) && styles.rowDone]} onPress={() => open(item)}>
            <View style={styles.thumbWrap}>
              {item.videoId ? (
                <Image source={{ uri: thumb(item.videoId) }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, { backgroundColor: '#1f2937' }]} />
              )}
              <View style={styles.playSmall}>
                <Ionicons name="play" size={18} color="#fff" />
              </View>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.num}>
                #{index + 1}
                {done.has(item.id) ? '  ✅ Done' : ''}
              </Text>
              <Text style={styles.name}>{item.name}</Text>
              {item.channel ? <Text style={styles.channel} numberOfLines={1}>{item.channel}</Text> : null}
            </View>
            <View style={styles.playBtn}>
              <Ionicons name="play" size={18} color="#fff" />
              <Text style={styles.playText}>Play</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  progressCard: { backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 12 },
  progressText: { fontWeight: '900', color: colors.text, fontSize: 16 },
  progressTrack: { height: 10, borderRadius: 5, backgroundColor: colors.paidBg, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 10, backgroundColor: colors.paid },
  rowDone: { backgroundColor: colors.paidBg },
  date: { color: colors.muted, fontWeight: '600', marginBottom: 10 },
  hero: { backgroundColor: colors.header, borderRadius: 20, padding: 16, marginBottom: 16 },
  heroLabel: { color: '#a7f3d0', fontWeight: '800', marginBottom: 10, fontSize: 15 },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 10 },
  heroSub: { color: '#e2e8f0', marginTop: 6, fontSize: 16 },
  heroThumbWrap: { borderRadius: 14, overflow: 'hidden', aspectRatio: 16 / 9, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  heroThumb: { ...StyleSheet.absoluteFill },
  playBig: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(22,163,74,0.95)', alignItems: 'center', justifyContent: 'center' },
  newBadge: { position: 'absolute', right: 14, top: 14, backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, zIndex: 2 },
  newBadgeText: { color: '#fff', fontWeight: '900', fontSize: 11 },
  days: { gap: 8, paddingBottom: 12 },
  dayPill: { backgroundColor: '#fff', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14, minWidth: 82, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  dayPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayShort: { fontWeight: '900', color: colors.text, fontSize: 16, marginTop: 2 },
  dayMuscle: { fontSize: 13, color: colors.muted, marginTop: 2, fontWeight: '600' },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: colors.text },
  sectionSub: { color: colors.muted, marginBottom: 12, fontSize: 15 },
  playBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, height: 40 },
  playText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 18, padding: 10, marginBottom: 10 },
  thumbWrap: { width: 112, height: 63, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumb: { ...StyleSheet.absoluteFill },
  playSmall: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  num: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  name: { color: colors.text, fontSize: 17, fontWeight: '800' },
  channel: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
