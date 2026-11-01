import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../context/AuthProvider';
import { ChatsProvider } from '../context/ChatsProvider';
import { IncomingCall } from '../components/IncomingCall';
import { NotificationRouter } from '../components/NotificationRouter';
import { Loading } from '../components/ui';
import { colors } from '../theme';

function RootNavigator() {
  const { user, profile, initializing } = useAuth();
  if (initializing) return <Loading />;
  const signedIn = !!user;
  const ready = signedIn && !!profile;

  const stack = (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !profile}>
        <Stack.Screen name="(auth)/profile" options={{ title: 'Your profile', headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={ready}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: '' }} />
        <Stack.Screen name="group/[id]" options={{ title: 'Group info' }} />
        <Stack.Screen name="group/add-members" options={{ title: 'Add members' }} />
        <Stack.Screen name="group/fee-settings" options={{ title: 'Fee & UPI settings' }} />
        <Stack.Screen name="new-group" options={{ title: 'New group' }} />
        <Stack.Screen name="new-chat" options={{ title: 'New chat' }} />
        <Stack.Screen name="profile" options={{ title: 'Me' }} />
        <Stack.Screen name="call/[id]" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
      </Stack.Protected>
    </Stack>
  );

  if (!ready) return stack;
  return (
    <ChatsProvider>
      {stack}
      <IncomingCall me={profile!} />
      <NotificationRouter me={profile!} />
    </ChatsProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </AuthProvider>
  );
}
