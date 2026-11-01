import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { friendlyGoogleError, signInWithGoogle } from '../../lib/googleAuth';
import { isServerNotConnected, NOT_CONNECTED_MESSAGE } from '../../lib/authErrors';
import { APP_NAME, colors } from '../../theme';

export default function Login() {
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (isServerNotConnected()) return Alert.alert('Setup not finished', NOT_CONNECTED_MESSAGE);
    setBusy(true);
    try {
      await signInWithGoogle(); // AuthProvider takes over (registration screen for new people)
    } catch (e: any) {
      const msg = friendlyGoogleError(e);
      if (msg !== null || !e?.code) Alert.alert('Could not sign in', msg ?? e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.header }} contentContainerStyle={styles.wrap}>
      <Image source={require('../../../assets/logo.png')} style={styles.logo} />
      <Text style={styles.title}>{APP_NAME}</Text>
      <Text style={styles.subtitle}>🏋️ Exercise · 💬 Chat · 📞 Call · ✅ Attendance · 💰 Fees</Text>
      {isServerNotConnected() && (
        <View style={styles.warn}>
          <Text style={styles.warnTitle}>⚠️ Setup not finished</Text>
          <Text style={styles.warnText}>{NOT_CONNECTED_MESSAGE}</Text>
        </View>
      )}
      <View style={styles.card}>
        <Text style={styles.h}>Welcome! 👋</Text>
        <Text style={styles.p}>New here or coming back? Use the same button. It's free, with no SMS code needed.</Text>
        <Pressable style={[styles.google, busy && { opacity: 0.7 }]} onPress={go} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.text} /> : <Ionicons name="logo-google" size={26} color="#EA4335" />}
          <Text style={styles.googleText}>{busy ? 'Opening Google…' : 'Continue with Google'}</Text>
        </Pressable>
        <Text style={styles.small}>New members: after choosing your Google account you'll type your name and phone number once.</Text>
      </View>
      <Text style={styles.credit}>Developed by Sanjoy Ingti · Ph: 7002397371</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logo: { alignSelf: 'center', width: 150, height: 150 },
  title: { color: '#fff', fontSize: 32, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  subtitle: { color: '#a7f3d0', textAlign: 'center', marginTop: 6, marginBottom: 28, fontSize: 15, lineHeight: 22 },
  warn: { backgroundColor: colors.warnBg, borderRadius: 16, padding: 14, marginBottom: 14 },
  warnTitle: { fontWeight: '900', fontSize: 16, color: colors.warnText },
  warnText: { color: colors.warnText, marginTop: 4, fontSize: 15 },
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 20 },
  h: { fontSize: 24, fontWeight: '900', color: colors.text },
  p: { color: colors.muted, marginTop: 6, marginBottom: 18, fontSize: 16 },
  google: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, height: 60, borderRadius: 30, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.card },
  googleText: { fontSize: 19, fontWeight: '800', color: colors.text },
  credit: { color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 24 },
  small: { color: colors.muted, marginTop: 14, fontSize: 14, textAlign: 'center' },
});
