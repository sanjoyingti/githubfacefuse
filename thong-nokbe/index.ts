// Custom entry: register the FCM background handler before the app mounts,
// then hand over to Expo Router.
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';

setBackgroundMessageHandler(getMessaging(), async () => {
  // Notifications with a `notification` payload are shown by the OS.
  // Nothing else to do here — tapping one opens the app at the right chat/call.
});

import 'expo-router/entry';
