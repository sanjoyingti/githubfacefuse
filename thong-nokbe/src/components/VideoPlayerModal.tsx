import React, { useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { Ionicons } from '@expo/vector-icons';
import { youtubeSearchUrl, type Exercise } from '../data/workouts';

export function VideoPlayerModal({ exercise, onClose }: { exercise: Exercise | null; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const h = Math.round((width * 9) / 16);

  const close = () => {
    setReady(false);
    setFailed(false);
    onClose();
  };

  return (
    <Modal visible={!!exercise} animationType="slide" onRequestClose={close} presentationStyle="fullScreen">
      <View style={styles.root}>
        <View style={styles.top}>
          <Pressable onPress={close} hitSlop={12}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <Text style={styles.topTitle} numberOfLines={1}>
            {exercise?.name}
          </Text>
          <View style={{ width: 28 }} />
        </View>
        {exercise?.videoId && !failed ? (
          <View style={{ height: h, justifyContent: 'center' }}>
            {!ready && <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} />}
            <YoutubePlayer
              height={h}
              width={width}
              play
              videoId={exercise.videoId}
              onReady={() => setReady(true)}
              onError={() => setFailed(true)}
              initialPlayerParams={{ rel: false, modestbranding: true }}
            />
          </View>
        ) : (
          <View style={[styles.fallback, { height: h }]}>
            <Ionicons name="logo-youtube" size={48} color="#ff0000" />
            <Text style={{ color: '#fff', marginTop: 8, textAlign: 'center' }}>
              This video can't play inside the app. Watch it on YouTube instead.
            </Text>
          </View>
        )}
        {exercise && (
          <View style={{ padding: 20 }}>
            {exercise.videoTitle ? <Text style={styles.vTitle}>{exercise.videoTitle}</Text> : null}
            {exercise.channel ? <Text style={styles.vChannel}>{exercise.channel}</Text> : null}
            <Pressable
              style={styles.ytBtn}
              onPress={() =>
                Linking.openURL(exercise.videoId && !failed ? `https://www.youtube.com/watch?v=${exercise.videoId}` : youtubeSearchUrl(exercise.name))
              }
            >
              <Ionicons name="logo-youtube" size={20} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', marginLeft: 8 }}>Open in YouTube</Text>
            </Pressable>
            <Pressable style={[styles.ytBtn, { backgroundColor: '#1f2937' }]} onPress={() => Linking.openURL(youtubeSearchUrl(exercise.name))}>
              <Ionicons name="search" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', marginLeft: 8 }}>More videos for this exercise</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', paddingTop: 48 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  topTitle: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  fallback: { alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#111' },
  vTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  vChannel: { color: '#9ca3af', marginTop: 4 },
  ytBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#dc2626', borderRadius: 12, height: 46, marginTop: 16 },
});
