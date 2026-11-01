import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBottomInset } from './useBottomInset';
import { colors } from '../theme';

export type SheetOption = { label: string; icon?: React.ComponentProps<typeof Ionicons>['name']; destructive?: boolean; onPress: () => void };

/** A menu that slides up from the bottom. Unlike Android pop-ups (max 3 buttons), it can show any number of choices. */
export function ActionSheet({ title, options, onClose }: { title: string | null; options: SheetOption[]; onClose: () => void }) {
  const bottomInset = useBottomInset();
  return (
    <Modal visible={!!title} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: 12 + bottomInset }]}>
        <Text style={styles.title}>{title}</Text>
        <ScrollView>
          {options.map((o) => (
            <Pressable
              key={o.label}
              style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.border }]}
              onPress={() => {
                onClose();
                o.onPress();
              }}
            >
              {o.icon && <Ionicons name={o.icon} size={24} color={o.destructive ? colors.unpaid : colors.primary} />}
              <Text style={[styles.label, o.destructive && { color: colors.unpaid }]}>{o.label}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.option, styles.cancel]} onPress={onClose}>
            <Text style={[styles.label, { color: colors.muted, textAlign: 'center', flex: 1 }]}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, maxHeight: '75%' },
  title: { color: colors.text, fontSize: 19, fontWeight: '900', paddingHorizontal: 20, paddingBottom: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, height: 58 },
  label: { color: colors.text, fontSize: 17, fontWeight: '700' },
  cancel: { marginTop: 4, borderTopWidth: 1, borderColor: colors.border },
});
