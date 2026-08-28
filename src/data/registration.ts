// Registers this device with the backend (get-or-create -- POST /v1/users never
// overwrites an existing profile, see backend/README.md). Every pantry/logs/diet
// request 404s until this has completed once, so App.tsx awaits it at startup,
// the same way it already awaits fonts loading.
import { api } from './api';
import { getDeviceId } from './device';

let registration: Promise<void> | null = null;

export function ensureDeviceRegistered(): Promise<void> {
  if (!registration) {
    registration = (async () => {
      const deviceId = await getDeviceId();
      await api.post('/v1/users', { user_id: deviceId, household_size: 1 });
    })();
  }
  return registration;
}