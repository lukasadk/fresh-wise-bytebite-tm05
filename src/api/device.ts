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
import * as Clipboard from 'expo-clipboard';

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

/** DEBUG ONLY -- clears BOTH keys, unlike resetDeviceId() which only clears
 *  the current one. This is what actually makes isFreshInstall() return true
 *  afterward, since it checks both. Used to simulate a genuine fresh install
 *  locally in Expo Go, where you can't actually uninstall/reinstall to test
 *  the real thing. Remove every call site before committing -- this should
 *  never ship. */
export async function resetAllDeviceKeys(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_KEY, LEGACY_STORAGE_KEY]);
  cached = null;
}

// --- Reinstall survival ------------------------------------------------
//
// Neither Android nor iOS preserves AsyncStorage across an uninstall -- the
// OS wipes the app's entire private storage sandbox, current key AND legacy
// key both, so getDeviceId()'s own self-healing logic has nothing left to
// find after a real reinstall (that logic only helps within the SAME
// install, e.g. a storage-key rename). This is the only thing that can
// actually survive an uninstall: writing the id somewhere OUTSIDE the app's
// own sandbox before it's deleted, and checking for it after reinstalling.
// The clipboard is the one such place available without native config.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only on a genuinely fresh install -- neither storage key has ever
 *  been written. Used to gate the restore-prompt so it never fires on a
 *  normal launch, only right after a reinstall. */
export async function isFreshInstall(): Promise<boolean> {
  const [stored, legacy] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEY),
    AsyncStorage.getItem(LEGACY_STORAGE_KEY),
  ]);
  return !stored && !legacy;
}

/** Returns a UUID sitting in the clipboard if it looks like one of ours,
 *  otherwise null. Doesn't touch AsyncStorage -- purely a check, the caller
 *  decides whether to actually adopt it (see adoptDeviceId). */
export async function checkClipboardForDeviceId(): Promise<string | null> {
  try {
    const text = (await Clipboard.getStringAsync()).trim();
    return UUID_PATTERN.test(text) ? text : null;
  } catch {
    return null; // clipboard read can fail (permissions, empty clipboard) -- treat as "nothing found"
  }
}

/** Adopts a specific id as this device's identity -- used by the
 *  restore-from-clipboard flow after the user confirms it's theirs. */
export async function adoptDeviceId(id: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, id);
  cached = id;
}

/** Copies the current device id to the clipboard. Called on every launch
 *  (see App.tsx) so that whenever a reinstall becomes necessary, a valid id
 *  is already waiting in the clipboard without the user doing anything. */
export async function copyDeviceIdToClipboard(): Promise<void> {
  const id = await getDeviceId();
  await Clipboard.setStringAsync(id);
}