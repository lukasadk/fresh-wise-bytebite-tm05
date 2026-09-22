import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { updateMe } from '../api/freshwise';

const EXPIRY_CHANNEL_ID = 'expiry-reminders';
const EXPIRY_CHANNEL_NAME = 'Expiry reminders';
const AMBER_GOLD = '#C68A2E';

Notifications.setNotificationHandler({
  handleNotification: async () =>
    ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }) as Notifications.NotificationBehavior,
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
