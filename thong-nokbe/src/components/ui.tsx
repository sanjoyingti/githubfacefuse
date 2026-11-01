import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { colors } from '../theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
  small,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  small?: boolean;
}) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.unpaid : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? '#fff' : variant === 'outline' ? colors.primary : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        variant === 'outline' && { borderWidth: 1.5, borderColor: colors.primary },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, small && { fontSize: 15 }, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.muted} style={[styles.input, style]} {...rest} />
    </View>
  );
}

export function Avatar({ name, size = 44, color }: { name?: string; size?: number; color?: string }) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  const palette = ['#16A34A', '#0EA5E9', '#8B5CF6', '#F59E0B', '#EF4444', '#14B8A6', '#EC4899'];
  const bg = color ?? palette[(name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.38 }}>{initials || '?'}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Empty({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', padding: 32 }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' }}>{title}</Text>
      {subtitle ? <Text style={{ color: colors.muted, marginTop: 6, textAlign: 'center' }}>{subtitle}</Text> : null}
      {children ? <View style={{ marginTop: 16, alignSelf: 'stretch' }}>{children}</View> : null}
    </View>
  );
}

export function Chip({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
      <Text style={{ color, fontWeight: '700', fontSize: 12 }}>{text}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnSmall: { height: 42, borderRadius: 12, paddingHorizontal: 14 },
  btnText: { fontWeight: '800', fontSize: 17 },
  label: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 6 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 54,
    fontSize: 18,
    color: colors.text,
  },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
});
