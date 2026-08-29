// Device identity.
//
// The app has NO login, account, email or password (see database-schema-no-pii.md).
// On first launch the device generates a random UUID, stores it locally, and
// sends it on every request. The backend creates/reuses a profile for whatever
// UUID it's given.
//
// This is deliberately device-only: reinstalling the app or switching phones
// starts a fresh, unrelated profile. That's the documented trade-off for
// collecting no personal information at all.
//
// Requires:
//   npx expo install @react-native-async-storage/async-storage expo-crypto

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const STORAGE_KEY = 'freshwise.deviceId';

// One-time migration: an earlier version of this app (before merging the two
// teams' work) stored the device UUID under this different key. Without this,
// anyone who used the app before the merge would silently get issued a BRAND
// NEW device UUID on first launch post-merge -- and since the backend scopes
// every pantry item to a device UUID, their existing items would still exist
// in Postgres but become permanently unreachable, looking exactly like data
// loss even though nothing was actually deleted.
const LEGACY_STORAGE_KEY = 'freshwise:deviceId';

let cached: string | null = null;

/** Returns this device's UUID, generating and persisting one on first call. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);

  // Self-healing, not just a first-run check: if the legacy key holds an id
  // that differs from (or is missing from) the current key, adopt the legacy
  // one. Covers both "never migrated yet" AND "already opened the app once
  // post-merge, so a new UUID got generated before this fix existed" -- either
  // way, the legacy id (and its pantry items) wins over a freshly-generated one.
  if (legacy && legacy !== stored) {
    await AsyncStorage.setItem(STORAGE_KEY, legacy);
    cached = legacy;
    return legacy;
  }

  if (stored) {
    cached = stored;
    return stored;
  }

  // Crypto.randomUUID() comes from expo-crypto. Do NOT use Math.random() here:
  // it isn't a cryptographic source, and collisions across devices would merge
  // two households' pantries into one profile.
  const fresh = Crypto.randomUUID();
  await AsyncStorage.setItem(STORAGE_KEY, fresh);
  cached = fresh;
  return fresh;
}

/** Wipes the local identity. The server-side profile is NOT deleted by this --
 *  call DELETE /v1/users/me first if the intent is "forget my data". */
export async function resetDeviceId(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  cached = null;
}