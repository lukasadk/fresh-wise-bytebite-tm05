// Device identity -- a single re-export, deliberately.
//
// This file used to hold a second, independent implementation: a different
// AsyncStorage key ('freshwise:deviceId' vs 'freshwise.deviceId') and a
// Math.random() UUID. With two implementations live at once the app generated
// TWO device ids on a fresh install -- App.tsx registered one via src/api/, and
// anything routed through src/data/ then minted another. The server had never
// heard of the second, so those calls 404'd with "No profile for this device
// UUID yet" while other screens worked. Confusing to diagnose, trivial to
// prevent: there is now exactly one implementation.
//
// src/api/device.ts is the one kept because it uses expo-crypto's
// Crypto.randomUUID() rather than Math.random(), and it already migrates the
// old 'freshwise:deviceId' key -- so existing installs keep their household
// instead of silently starting over.
export { getDeviceId, resetDeviceId } from '../api/device';
