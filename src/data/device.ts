// This backend has no login/accounts (see backend/README.md) -- identity is a UUID
// this device generates once on first launch and persists locally forever after.
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = 'freshwise:deviceId';

// Not cryptographically random -- doesn't need to be, this only identifies a device
// locally, it's never used as a secret. Avoids adding expo-crypto as a dependency
// just for this one UUID.
function generateUuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) {
    cachedDeviceId = stored;
    return stored;
  }

  const id = generateUuidV4();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  cachedDeviceId = id;
  return id;
}