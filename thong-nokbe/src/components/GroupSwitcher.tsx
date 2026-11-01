import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useChats } from '../context/ChatsProvider';
import { colors } from '../theme';
import { Avatar, Button, Empty } from './ui';

/** Header strip used by the Attendance and Fees tabs to pick which gym group to show. */
export function GroupSwitcher() {
  const { groups, selectedGroup, selectGroup } = useChats();
  const [open, setOpen] = useState(false);
  if (!selectedGroup) return null;
  return (
    <>
      <Pressable style={styles.bar} onPress={() => groups.length > 1 && setOpen(true)}>
        <Avatar name={selectedGroup.name} size={32} />
        <Text style={styles.name} numberOfLines={1}>
          {selectedGroup.name}
        </Text>
        {groups.length > 1 && <Ionicons name="chevron-down" size={18} color={colors.muted} />}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Choose gym group</Text>
            <FlatList
              data={groups}
              keyExtractor={(g) => g.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.row}
                  onPress={() => {
                    selectGroup(item.id);
                    setOpen(false);
                  }}
                >
                  <Avatar name={item.name} size={36} />
                  <Text style={[styles.name, { marginLeft: 12 }]}>{item.name}</Text>
                  {item.id === selectedGroup.id && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export function NoGroups() {
  return (
    <Empty title="You're not in any gym group yet" subtitle="Create a group for your gym, or ask your gym admin to add your phone number.">
      <Button title="Create a group" onPress={() => router.push('/new-group')} />
    </Empty>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '60%' },
  sheetTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
});
