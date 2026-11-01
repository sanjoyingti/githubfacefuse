import React, { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { useLinkingURL } from 'expo-linking';
import { inviteCodeFromUrl, savePendingInvite, takePendingInvite } from '../lib/pendingInvite';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../context/AuthProvider';
import { ChatsProvider } from '../context/ChatsProvider';
import { IncomingCall } from '../components/IncomingCall';
import { NotificationRouter } from '../components/NotificationRouter';
import { Loading } from '../components/ui';
import { colors } from '../theme';

function RootNavigator() {
  const { user, profile, initializing } = useAuth();
  const signedIn = !!user;
  const ready = !initializing && signedIn && !!profile;

  // Invite links opened before signing in: remember them and open "Join group" once ready.
  const url = useLinkingURL();
  useEffect(() => {
    const code = inviteCodeFromUrl(url);
    if (code && !ready) savePendingInvite(code);
  }, [url, ready]);
  useEffect(() => {
    if (!ready) return;
    takePendingInvite().then((code) => code && router.push(`/join/${code}`));
  }, [ready]);

  if (initializing) return <Loading />;

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
        <Stack.Screen name="(auth)/profile" options={{ title: 'Register', headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={ready}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: '' }} />
        <Stack.Screen name="group/[id]" options={{ title: 'Group info' }} />
        <Stack.Screen name="group/add-members" options={{ title: 'Add members' }} />
        <Stack.Screen name="group/fee-settings" options={{ title: 'Fee & UPI settings' }} />
        <Stack.Screen name="group/invite" options={{ title: 'Invite via link' }} />
        <Stack.Screen name="group/fee-report" options={{ title: 'Fee report' }} />
        <Stack.Screen name="join/[code]" options={{ title: 'Join group' }} />
        <Stack.Screen name="new-group" options={{ title: 'New group' }} />
        <Stack.Screen name="new-chat" options={{ title: 'New chat' }} />
        <Stack.Screen name="profile" options={{ title: 'Me' }} />
        <Stack.Screen name="play" options={{ title: 'Exercise', headerStyle: { backgroundColor: '#0b0f0d' } }} />
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
