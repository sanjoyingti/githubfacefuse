import React from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMe } from '../../context/AuthProvider';
import { Avatar } from '../../components/ui';
import { colors } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) =>
  function TabIcon({ color }: { color: unknown }) {
    return <Ionicons name={name} size={28} color={(color as string) ?? undefined} />;
  };

function MeButton() {
  const me = useMe();
  return (
    <Pressable onPress={() => router.push('/profile')} style={{ marginRight: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLabel="My profile">
      <Text style={{ color: '#fff', fontWeight: '700' }}>Me</Text>
      <Avatar name={me.name} size={34} />
    </Pressable>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '800', fontSize: 20 },
        headerRight: () => <MeButton />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: '#64748B',
        tabBarLabelStyle: { fontSize: 13, fontWeight: '800' },
        tabBarStyle: { height: 68 + insets.bottom, paddingTop: 6, paddingBottom: 8 + insets.bottom },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Exercise', headerTitle: 'Thong Nokbe Gym', tabBarIcon: icon('barbell') }} />
      <Tabs.Screen name="chats" options={{ title: 'Chat', headerTitle: 'Chat', tabBarIcon: icon('chatbubbles') }} />
      <Tabs.Screen name="calls" options={{ title: 'Call', headerTitle: 'Call', tabBarIcon: icon('call') }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance', tabBarIcon: icon('checkmark-done-circle') }} />
      <Tabs.Screen name="fees" options={{ title: 'Fees', tabBarIcon: icon('wallet') }} />
    </Tabs>
  );
}
