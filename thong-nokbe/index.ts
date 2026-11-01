// Custom entry: let Firebase Cloud Messaging work while the app is closed, then start Expo Router.
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';

setBackgroundMessageHandler(getMessaging(), async () => {
  // Call and message notifications carry a "notification" payload, so Android shows them
  // (with the ringtone for calls) even when the app is closed. Nothing else to do here.
});

import 'expo-router/entry';
