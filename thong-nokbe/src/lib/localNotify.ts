import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { APP_NAME } from '../theme';

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
        await Notifications.setNotificationChannelAsync('default', { name: 'Messages & calls', importance: AndroidImportance.HIGH, sound: 'default' });
      }
      const { granted } = await Notifications.requestPermissionsAsync();
      return granted;
    })().catch(() => false);
  }
  return ready;
}

/** Shows a notification only when the app is not on screen. */
export async function notifyIfAway(title: string, body: string, data: Record<string, string>) {
  if (AppState.currentState === 'active') return;
  if (!(await setupNotifications())) return;
  await Notifications.scheduleNotificationAsync({ content: { title, body, data, sound: 'default' }, trigger: null }).catch(() => {});
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
