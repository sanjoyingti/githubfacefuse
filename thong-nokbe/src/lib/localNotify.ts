import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { APP_NAME } from '../theme';
import { isPushReady } from './push';

/**
 * Notifications made on the phone itself (free, no server). They work while the app is open
 * or still running in the background, plus a monthly fee reminder alarm.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let ready: Promise<boolean> | null = null;

export function setupNotifications(): Promise<boolean> {
  if (!ready) {
    ready = (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('messages', { name: 'Messages & fee notices', importance: AndroidImportance.HIGH, sound: 'default' });
        await Notifications.setNotificationChannelAsync('calls', {
          name: 'Incoming calls',
          importance: AndroidImportance.MAX,
          sound: 'ringtone.wav',
          vibrationPattern: [0, 800, 600, 800, 600, 800],
          lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
        });
      }
      const { granted } = await Notifications.requestPermissionsAsync();
      return granted;
    })().catch(() => false);
  }
  return ready;
}

/** Shows a notification only when the app is not on screen. */
export async function notifyIfAway(title: string, body: string, data: Record<string, string>, evenIfOpen = false) {
  const active = AppState.currentState === 'active';
  if (active && !evenIfOpen) return;
  if (!active && isPushReady()) return; // the server's push notification covers this (no duplicates)
  if (!(await setupNotifications())) return;
  const channelId = data.kind === 'call' ? 'calls' : 'messages';
  await Notifications.scheduleNotificationAsync({ content: { title, body, data, sound: data.kind === 'call' ? 'ringtone.wav' : 'default' }, trigger: { channelId } }).catch(() => {});
}

const FEE_REMINDER_ID = 'fee-due-reminder';

/** Alarm on the 1st of every month at 9:00 AM: "Gym fee is due today". */
export async function scheduleFeeReminder(amount?: number) {
  if (!(await setupNotifications())) return;
  await Notifications.cancelScheduledNotificationAsync(FEE_REMINDER_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: FEE_REMINDER_ID,
    content: {
      title: `${APP_NAME}: gym fee due today 💰`,
      body: amount ? `Your ₹${amount} monthly fee is due. Tap to pay in the Fees tab.` : 'Your monthly gym fee is due. Tap to pay in the Fees tab.',
      data: { kind: 'fees' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.MONTHLY, day: 1, hour: 9, minute: 0 },
  }).catch(() => {});
}
