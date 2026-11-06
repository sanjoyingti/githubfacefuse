import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { hasBackgroundLocation, setSharing } from '../lib/liveLocation';
import { askIgnoreBatteryOptimization } from '../lib/permissions';
import { colors } from '../theme';

/**
 * While live location is ON: shows whether the group can see me even when the app is closed, with
 * one-tap fixes — Location "Allow all the time" and Android's battery saver.
 */
export function BackgroundLocationTips({ myName }: { myName: string }) {
  const [bg, setBg] = useState<boolean | null>(null);
  const refresh = useCallback(() => hasBackgroundLocation().then(setBg), []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      // Back from the settings page: if "all the time" was just allowed, start the background sharing.
      hasBackgroundLocation().then((ok) => {
        setBg(ok);
        if (ok) setSharing(true, myName).catch(() => {});
      });
    });
    return () => sub.remove();
  }, [refresh, myName]);

  const allowAllTheTime = async () => {
    const r = await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
    if (r.granted) {
      setBg(true);
      await setSharing(true, myName).catch(() => {});
    } else Linking.openSettings(); // Android 11+: choose Location → "Allow all the time"
  };

  if (bg === null) return null;
  return (
    <View style={[styles.box, { borderColor: bg ? colors.paid : colors.warnText, backgroundColor: bg ? colors.paidBg : colors.warnBg }]}>
      <Text style={[styles.title, { color: bg ? colors.paid : colors.warnText }]}>
        {bg ? '✅ Shared even when the app is closed' : '⚠️ Only while the app is open'}
      </Text>
      {!bg && (
        <>
          <Text style={styles.text}>To be seen when the app is closed, set Location to “Allow all the time”.</Text>
          <Pressable style={styles.btn} onPress={allowAllTheTime}>
            <Text style={styles.btnText}>📍 Allow all the time</Text>
          </Pressable>
        </>
      )}
      <Text style={styles.text}>Phones save battery by stopping apps in the background. Allow Thong Nokbe Gym to keep running:</Text>
      <Pressable style={[styles.btn, styles.btn2]} onPress={() => askIgnoreBatteryOptimization()}>
        <Text style={[styles.btnText, { color: colors.text }]}>🔋 Allow in background (battery)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1.5, borderRadius: 14, padding: 12, marginTop: 10 },
  title: { fontWeight: '900', fontSize: 14 },
  text: { color: colors.text, fontSize: 13, marginTop: 6 },
  btn: { marginTop: 8, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  btn2: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.border },
  btnText: { color: '#fff', fontWeight: '800' },
});
