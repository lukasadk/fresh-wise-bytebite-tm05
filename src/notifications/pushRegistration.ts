import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
// Type-only import: erased at build time, so it never loads the module itself.
import type * as NotificationsModule from 'expo-notifications';

import { updateMe } from '../api/freshwise';

const EXPIRY_CHANNEL_ID = 'expiry-reminders';
const EXPIRY_CHANNEL_NAME = 'Expiry reminders';
const AMBER_GOLD = '#C68A2E';

// Expo Go (the store app) removed Android push notifications in SDK 53: merely
// LOADING expo-notifications there throws "[runtime not ready]" and crashes the
// whole app before any screen renders. So the module is only loaded when we're
// NOT in Expo Go on Android. The APK / EAS / development builds report a
// different execution environment ('standalone' or 'bare'), so they load it and
// behave exactly as before. Expo Go on iOS still supports it, so it loads there too.
const pushUnsupported =
  Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const Notifications: typeof NotificationsModule | null = pushUnsupported
  ? null
  : // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('expo-notifications') as typeof NotificationsModule);

Notifications?.setNotificationHandler({
  handleNotification: async () =>
    ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }) as NotificationsModule.NotificationBehavior,
});

function getProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? undefined
  );
}

export async function registerPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  // Expo Go on Android: no push support. Same outcome as the user declining
  // permission -- App.tsx already treats null as "no push, carry on".
  if (!Notifications) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(EXPIRY_CHANNEL_ID, {
      name: EXPIRY_CHANNEL_NAME,
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: AMBER_GOLD,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const currentPermission = await Notifications.getPermissionsAsync();
  let finalStatus = currentPermission.status;
  if (finalStatus !== 'granted') {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermission.status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId = getProjectId();
  const token = projectId
    ? (await Notifications.getExpoPushTokenAsync({ projectId })).data
    : (await Notifications.getExpoPushTokenAsync()).data;

  await updateMe({ push_token: token });
  return token;
}