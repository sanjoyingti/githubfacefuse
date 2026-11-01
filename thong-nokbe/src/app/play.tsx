import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import YoutubePlayer, { PLAYER_STATES, type YoutubeIframeRef } from 'react-native-youtube-iframe';
import { DAY_EMOJI, getWorkoutDay, type WorkoutDayKey } from '../data/workouts';
import { toggleDone, useDoneToday } from '../lib/workoutProgress';
import { useBottomInset } from '../components/useBottomInset';
import { colors } from '../theme';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Simple in-app exercise player: big buttons, slow motion, previous/next, mark as done. No outside apps. */
export default function Play() {
  const { day: dayParam, i } = useLocalSearchParams<{ day: WorkoutDayKey; i: string }>();
  const day = getWorkoutDay(dayParam ?? 'monday')!;
  const [index, setIndex] = useState(Math.max(0, Math.min(day.exercises.length - 1, Number(i) || 0)));
  const [retryKey, setRetryKey] = useState(0);
  const ex = day.exercises[index];
  const bottomInset = useBottomInset();
  const done = useDoneToday();
  const go = (d: number) => setIndex((n) => Math.max(0, Math.min(day.exercises.length - 1, n + d)));
  const isDone = done.has(ex.id);

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0f0d' }}>
      <Stack.Screen options={{ title: `${DAY_EMOJI[day.key]} ${day.title}` }} />
      {/* key: a fresh player (and fresh play/progress state) for every exercise or retry */}
      <VideoPanel key={`${ex.id}-${retryKey}`} videoId={ex.videoId} onRetry={() => setRetryKey((k) => k + 1)} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 + bottomInset }}>
        <Text style={styles.count}>
          Exercise {index + 1} of {day.exercises.length}
        </Text>
        <Text style={styles.name}>{ex.name}</Text>
        <Text style={styles.tip}>💡 Usually 3 sets of 10–12 reps. Rest 1 minute between sets. Start light and keep good form.</Text>

        <Pressable style={[styles.doneBtn, isDone && styles.doneBtnOn]} onPress={() => toggleDone(ex.id)}>
          <Ionicons name={isDone ? 'checkmark-circle' : 'ellipse-outline'} size={28} color={isDone ? '#fff' : colors.primary} />
          <Text style={[styles.doneText, isDone && { color: '#fff' }]}>{isDone ? 'Done today ✓' : 'Mark as done'}</Text>
        </Pressable>

        <View style={styles.navRow}>
          <Pressable style={[styles.navBtn, index === 0 && styles.navOff]} disabled={index === 0} onPress={() => go(-1)}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
            <Text style={styles.navText}>Previous</Text>
          </Pressable>
          {index < day.exercises.length - 1 ? (
            <Pressable style={[styles.navBtn, styles.navNext]} onPress={() => go(1)}>
              <Text style={styles.navText}>Next</Text>
              <Ionicons name="arrow-forward" size={22} color="#fff" />
            </Pressable>
          ) : (
            <Pressable style={[styles.navBtn, styles.navNext]} onPress={() => router.back()}>
              <Text style={styles.navText}>Finish 🎉</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function VideoPanel({ videoId, onRetry }: { videoId: string | null; onRetry: () => void }) {
  const { width } = useWindowDimensions();
  const height = Math.round((width * 9) / 16);
  const player = useRef<YoutubeIframeRef | null>(null);
  // `want` is what we ask the player to do; `isPlaying` is what it is really doing.
  const [want, setWant] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [started, setStarted] = useState(false); // video has really shown at least one frame
  const [buffering, setBuffering] = useState(true);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [barWidth, setBarWidth] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Update the progress bar while playing.
  useEffect(() => {
    if (!isPlaying || !ready) return;
    const t = setInterval(async () => {
      const p = player.current;
      if (!p) return;
      setTime(await p.getCurrentTime());
      if (!duration) setDuration(await p.getDuration());
    }, 500);
    return () => clearInterval(t);
  }, [isPlaying, ready, duration]);

  // If the phone silently refuses to start the video, stop the spinner and show our play button.
  useEffect(() => {
    if (!ready || started) return;
    const t = setTimeout(() => setBuffering(false), 2500);
    return () => clearTimeout(t);
  }, [ready, started]);

  const onState = (s: PLAYER_STATES) => {
    if (s === PLAYER_STATES.PLAYING) {
      setIsPlaying(true);
      setStarted(true);
      setBuffering(false);
      setEnded(false);
      setWant(true);
    } else if (s === PLAYER_STATES.BUFFERING) {
      setBuffering(true);
    } else if (s === PLAYER_STATES.ENDED) {
      setIsPlaying(false);
      setBuffering(false);
      setEnded(true);
      setWant(false);
    } else if (s === PLAYER_STATES.PAUSED) {
      setIsPlaying(false);
      setBuffering(false);
      setWant(false);
    } else if (s === PLAYER_STATES.UNSTARTED || s === PLAYER_STATES.VIDEO_CUED) {
      setBuffering(false); // phone blocked auto-start: our play button takes over
    }
  };

  /** Ask the player to play, even if we had already asked before (the phone may have ignored it). */
  const play = () => {
    setBuffering(true);
    if (want) {
      setWant(false);
      requestAnimationFrame(() => setWant(true));
    } else setWant(true);
  };
  const pause = () => setWant(false);

  const seek = (delta: number) => {
    const t = Math.max(0, Math.min(duration || 1e9, time + delta));
    player.current?.seekTo(t, true);
    setTime(t);
  };
  const restart = () => {
    player.current?.seekTo(0, true);
    setTime(0);
    setEnded(false);
    play();
  };
  const toggle = () => (ended ? restart() : isPlaying ? pause() : play());
  const showPlaying = isPlaying || (want && buffering);
  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <View>
      <View style={{ width, height, backgroundColor: '#000', justifyContent: 'center' }}>
        {videoId && !failed ? (
          <>
            <YoutubePlayer
              ref={player}
              height={height}
              width={width}
              videoId={videoId}
              play={want}
              forceAndroidAutoplay
              playbackRate={speed}
              onReady={() => setReady(true)}
              onChangeState={onState}
              onError={() => setFailed(true)}
              initialPlayerParams={{ controls: false, rel: false, iv_load_policy: 3, preventFullScreen: true }}
              webViewProps={{ allowsFullscreenVideo: false }}
            />
            {/* Our own cover: hides YouTube's red play button, title and suggestions. Tap = play/pause. */}
            <Pressable style={StyleSheet.absoluteFill} onPress={toggle}>
              {(!started || ended) && (
                <Image source={{ uri: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }} style={[StyleSheet.absoluteFill, styles.cover]} resizeMode="cover" />
              )}
              {started && !ended && !isPlaying && <View style={[StyleSheet.absoluteFill, styles.dim]} />}
              {want && buffering ? (
                <View style={styles.centerIcon}>
                  <ActivityIndicator color="#fff" size="large" />
                </View>
              ) : (
                !isPlaying && (
                  <View style={styles.centerIcon}>
                    <Ionicons name={ended ? 'refresh' : 'play'} size={52} color="#fff" style={ended ? undefined : { marginLeft: 6 }} />
                  </View>
                )
              )}
            </Pressable>
          </>
        ) : (
          <View style={styles.offline}>
            <Ionicons name="wifi" size={40} color="#94a3b8" />
            <Text style={styles.offlineText}>Can't play this video. Check your internet (Wi-Fi or mobile data).</Text>
            <Pressable style={styles.retry} onPress={onRetry}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>🔄 Try again</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.progressRow}>
        <Text style={styles.time}>{fmt(time)}</Text>
        {/* Tap anywhere on the bar to jump there */}
        <Pressable
          style={styles.trackTouch}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width || 1)}
          onPress={(e) => {
            if (!duration) return;
            const t = Math.max(0, Math.min(duration, (e.nativeEvent.locationX / barWidth) * duration));
            player.current?.seekTo(t, true);
            setTime(t);
          }}
        >
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct}%` }]} />
          </View>
          <View style={[styles.knob, { left: `${pct}%` }]} />
        </Pressable>
        <Text style={styles.time}>{duration ? fmt(duration) : '--:--'}</Text>
      </View>

      <View style={styles.controls}>
        <Ctrl icon="play-back" label="Rewind 10s" onPress={() => seek(-10)} />
        <View style={{ alignItems: 'center' }}>
          <Pressable style={styles.playBtn} onPress={toggle} accessibilityLabel={showPlaying ? 'Pause' : 'Play'}>
            <Ionicons name={ended ? 'refresh' : showPlaying ? 'pause' : 'play'} size={40} color="#fff" />
          </Pressable>
          <Text style={styles.ctrlLabel}>{ended ? 'Replay' : showPlaying ? 'Pause' : 'Play'}</Text>
        </View>
        <Ctrl icon="play-forward" label="Forward 10s" onPress={() => seek(10)} />
      </View>
      <View style={styles.controls2}>
        {(
          [
            [0.5, '🐢 0.5×'],
            [1, '1×'],
            [1.5, '1.5×'],
            [2, '⏩ 2×'],
          ] as const
        ).map(([v, label]) => (
          <Pressable key={v} style={[styles.pill, speed === v && styles.pillOn]} onPress={() => setSpeed(v)} accessibilityLabel={`Speed ${v}`}>
            <Text style={[styles.pillText, speed === v && { color: '#0b0f0d' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.controls2}>
        <Pressable style={styles.pill} onPress={restart}>
          <Text style={styles.pillText}>⏮ Start again</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Ctrl({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.ctrl} onPress={onPress} accessibilityLabel={label}>
      <Ionicons name={icon} size={28} color="#fff" />
      <Text style={styles.ctrlLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cover: { backgroundColor: '#000' },
  dim: { backgroundColor: 'rgba(0,0,0,0.75)' },
  centerIcon: { position: 'absolute', top: '50%', left: '50%', marginTop: -55, marginLeft: -55, width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(22,163,74,0.9)', alignItems: 'center', justifyContent: 'center' },
  offline: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  offlineText: { color: '#e2e8f0', textAlign: 'center', marginTop: 8, fontSize: 15 },
  retry: { marginTop: 12, backgroundColor: colors.primary, paddingHorizontal: 18, height: 42, borderRadius: 21, justifyContent: 'center' },
  progressRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  time: { color: '#cbd5e1', fontVariant: ['tabular-nums'], fontSize: 13, width: 40, textAlign: 'center' },
  trackTouch: { flex: 1, height: 28, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: '#334155', overflow: 'hidden' },
  knob: { position: 'absolute', width: 18, height: 18, borderRadius: 9, marginLeft: -9, backgroundColor: '#fff', top: 5 },
  fill: { height: 6, backgroundColor: colors.primary },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingTop: 14 },
  ctrl: { alignItems: 'center', width: 96 },
  ctrlLabel: { color: '#cbd5e1', fontSize: 12, marginTop: 2, fontWeight: '700' },
  playBtn: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  controls2: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingTop: 12 },
  pill: { borderWidth: 2, borderColor: '#475569', borderRadius: 20, paddingHorizontal: 12, height: 40, justifyContent: 'center' },
  pillOn: { backgroundColor: '#fde047', borderColor: '#fde047' },
  pillText: { color: '#e2e8f0', fontWeight: '800' },
  count: { color: '#94a3b8', fontWeight: '700' },
  name: { color: '#fff', fontSize: 24, fontWeight: '900', marginTop: 2 },
  tip: { color: '#cbd5e1', marginTop: 8, fontSize: 15, lineHeight: 21 },
  doneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 16, height: 56, borderRadius: 28, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.card },
  doneBtnOn: { backgroundColor: colors.primary },
  doneText: { fontSize: 18, fontWeight: '900', color: colors.primary },
  navRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  navBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 27, backgroundColor: '#334155' },
  navNext: { backgroundColor: colors.primary },
  navOff: { opacity: 0.4 },
  navText: { color: '#fff', fontSize: 17, fontWeight: '900' },
});
