import React, { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WORKOUT_DAYS, exerciseOfTheDay, getWorkoutDay, todayKey, type Exercise, type WorkoutDayKey } from '../../data/workouts';
import { VideoPlayerModal } from '../../components/VideoPlayerModal';
import { formatDayLong } from '../../lib/dates';
import { colors } from '../../theme';

const thumb = (id: string | null) => (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : undefined);

export default function Workouts() {
  const today = todayKey();
  const isRestDay = today === 'sunday';
  const [selected, setSelected] = useState<WorkoutDayKey>(isRestDay ? 'monday' : (today as WorkoutDayKey));
  const [playing, setPlaying] = useState<Exercise | null>(null);
  const day = getWorkoutDay(selected)!;
  const featured = useMemo(() => (isRestDay ? null : exerciseOfTheDay(getWorkoutDay(today)!)), [today, isRestDay]);

  const header = (
    <View>
      <Text style={styles.date}>{formatDayLong(new Date())}</Text>
      {isRestDay ? (
        <View style={[styles.hero, { backgroundColor: '#334155' }]}>
          <Ionicons name="bed" size={28} color="#fff" />
          <Text style={styles.heroTitle}>Sunday: rest & recover</Text>
          <Text style={styles.heroSub}>No workout today. Stretch, hydrate, and look ahead to Monday's chest day below.</Text>
        </View>
      ) : (
        featured && (
          <Pressable style={styles.hero} onPress={() => setPlaying(featured)}>
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>NEW TODAY</Text>
            </View>
            <Text style={styles.heroLabel}>Exercise of the day · {getWorkoutDay(today)!.title}</Text>
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
              <Text style={[styles.dayShort, active && { color: '#fff' }]}>
                {d.short}
                {d.key === today ? ' •' : ''}
              </Text>
              <Text style={[styles.dayMuscle, active && { color: '#dcfce7' }]}>{d.muscle}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.sectionTitle}>
        {day.label} · {day.title} · {day.exercises.length} exercises
      </Text>
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
          <Pressable style={styles.row} onPress={() => setPlaying(item)}>
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
              <Text style={styles.num}>#{index + 1}</Text>
              <Text style={styles.name}>{item.name}</Text>
              {item.channel ? <Text style={styles.channel} numberOfLines={1}>{item.channel}</Text> : null}
            </View>
            <Ionicons name="play-circle" size={36} color={colors.primary} />
          </Pressable>
        )}
      />
      <VideoPlayerModal exercise={playing} onClose={() => setPlaying(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  date: { color: colors.muted, fontWeight: '600', marginBottom: 10 },
  hero: { backgroundColor: colors.header, borderRadius: 20, padding: 16, marginBottom: 16 },
  heroLabel: { color: '#a7f3d0', fontWeight: '700', marginBottom: 10 },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 10 },
  heroSub: { color: '#cbd5e1', marginTop: 6 },
  heroThumbWrap: { borderRadius: 14, overflow: 'hidden', aspectRatio: 16 / 9, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  heroThumb: { ...StyleSheet.absoluteFill },
  playBig: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(22,163,74,0.95)', alignItems: 'center', justifyContent: 'center' },
  newBadge: { position: 'absolute', right: 14, top: 14, backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, zIndex: 2 },
  newBadgeText: { color: '#fff', fontWeight: '900', fontSize: 11 },
  days: { gap: 8, paddingBottom: 12 },
  dayPill: { backgroundColor: '#fff', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  dayPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayShort: { fontWeight: '800', color: colors.text },
  dayMuscle: { fontSize: 11, color: colors.muted, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 10, marginBottom: 10 },
  thumbWrap: { width: 112, height: 63, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumb: { ...StyleSheet.absoluteFill },
  playSmall: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  num: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  channel: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
