// Local expiry reminders -- scheduled ON THE PHONE, no server push, no Firebase.
//
// Every time the full pantry is loaded (see listPantry() in src/api/freshwise.ts),
// this cancels FreshWise's previous expiry reminders and schedules new ones from
// the current pantry: one notification per day, at REMINDER_HOUR, the day before
// food expires ("2 items expire tomorrow: Milk, Spinach"). Items that were
// consumed, wasted or deleted are no longer in the pantry, so their reminders
// disappear on the next sync automatically.
//
// Works in an EAS-built APK (not in Expo Go on Android). Android shows the notification even
// when the app is closed. Limitation: reminders are only as fresh as the last
// time this phone loaded the pantry.

import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type * as NotificationsModule from 'expo-notifications';

// Expo Go on Android (SDK 53+) throws as soon as expo-notifications is loaded,
// so reminders are skipped there. They work in the APK (EAS build).
const IS_EXPO_GO_ANDROID =
  Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
import type { FoodItem } from '../api/types';

// Loaded lazily, like pushRegistration.ts does, so a platform where the module
// can't load just skips reminders instead of crashing the app.
let Notifications: typeof NotificationsModule | null | undefined;
function getNotifications(): typeof NotificationsModule | null {
  if (Notifications !== undefined) return Notifications;
  if (IS_EXPO_GO_ANDROID) {
    Notifications = null;
    return Notifications;
  }
  try {
    Notifications = require('expo-notifications') as typeof NotificationsModule;
  } catch {
    Notifications = null;
  }
  return Notifications;
}

const REMINDER_HOUR = 9; // 9:00 am local time
const CHANNEL_ID = 'expiry-reminders';
const REMINDER_KIND = 'freshwise-expiry';
const MAX_SCHEDULED_DAYS = 30; // keeps well under Android's alarm limit

let permissionChecked = false;
let permissionGranted = false;
let lastSignature = '';
let queue: Promise<void> = Promise.resolve();

/** Ask for permission and create the Android channel. Safe to call many times. */
export async function prepareExpiryReminders(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (permissionChecked) return permissionGranted;
  const Notifications = getNotifications();
  if (!Notifications) {
    permissionChecked = true;
    return false;
  }
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Expiry reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    permissionGranted = granted;
  } catch {
    permissionGranted = false;
  }
  permissionChecked = true;
  return permissionGranted;
}

/** "YYYY-MM-DD" -> that date at REMINDER_HOUR, local time, minus `daysBefore`. */
function reminderTime(expiryDate: string, daysBefore: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiryDate);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d) - daysBefore, REMINDER_HOUR, 0, 0, 0);
}

function listNames(names: string[]): string {
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

/** Re-schedules all expiry reminders from the current pantry. Never throws. */
export function syncExpiryReminders(items: FoodItem[]): Promise<void> {
  queue = queue.then(() => doSync(items)).catch(() => {});
  return queue;
}

async function doSync(items: FoodItem[]): Promise<void> {
  if (!(await prepareExpiryReminders())) return;
  const Notifications = getNotifications();
  if (!Notifications) return;

  const now = Date.now();
  // Group by reminder moment: the day before expiry, or the expiry day itself
  // if the day-before reminder time has already passed.
  const groups = new Map<number, { when: Date; today: boolean; names: string[] }>();
  for (const item of items) {
    if (!item.expiry_date || !item.name) continue;
    let when = reminderTime(item.expiry_date, 1);
    let today = false;
    if (when && when.getTime() <= now) {
      when = reminderTime(item.expiry_date, 0);
      today = true;
    }
    if (!when || when.getTime() <= now) continue;
    const key = when.getTime();
    const group = groups.get(key) ?? { when, today, names: [] };
    if (!group.names.includes(item.name)) group.names.push(item.name);
    groups.set(key, group);
  }

  const plan = [...groups.values()]
    .sort((a, b) => a.when.getTime() - b.when.getTime())
    .slice(0, MAX_SCHEDULED_DAYS);

  // Nothing changed since the last sync: leave the existing alarms alone.
  const signature = plan.map((g) => `${g.when.getTime()}:${g.today}:${g.names.join('|')}`).join(';');
  if (signature === lastSignature) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.content.data?.kind === REMINDER_KIND)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );

  for (const group of plan) {
    const count = group.names.length;
    const when = group.today ? 'today' : 'tomorrow';
    await Notifications.scheduleNotificationAsync({
      content: {
        title: count === 1 ? `${group.names[0]} expires ${when}` : `${count} items expire ${when}`,
        body: `Use ${listNames(group.names)} first. Open FreshWise for recipe ideas.`,
        data: { kind: REMINDER_KIND },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: group.when,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
    });
  }
  lastSignature = signature;
}