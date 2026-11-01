import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import type { CallKind } from '../lib/types';

/** Two big, labelled buttons: 📞 Voice and 📹 Video. */
export function CallButtons({ onCall, disabled, compact }: { onCall: (kind: CallKind) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Pressable disabled={disabled} onPress={() => onCall('voice')} style={[styles.btn, { backgroundColor: colors.voice }, compact && styles.compact, disabled && styles.off]}>
        <Ionicons name="call" size={compact ? 20 : 22} color="#fff" />
        {!compact && <Text style={styles.label}>Voice</Text>}
      </Pressable>
      <Pressable disabled={disabled} onPress={() => onCall('video')} style={[styles.btn, { backgroundColor: colors.primary }, compact && styles.compact, disabled && styles.off]}>
        <Ionicons name="videocam" size={compact ? 20 : 22} color="#fff" />
        {!compact && <Text style={styles.label}>Video</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 46, borderRadius: 23 },
  compact: { width: 46, paddingHorizontal: 0, justifyContent: 'center' },
  label: { color: '#fff', fontWeight: '800', fontSize: 15 },
  off: { backgroundColor: '#CBD5E1' },
});
