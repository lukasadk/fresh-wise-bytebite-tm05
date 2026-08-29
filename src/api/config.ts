// Where the FastAPI backend lives.
//
// IMPORTANT: on a phone (Expo Go) or an Android emulator, "localhost" means
// THE DEVICE, not your laptop -- so a plain localhost URL silently fails with a
// network error. Use your machine's LAN IP while developing:
//
//   Windows:  ipconfig      -> "IPv4 Address" e.g. 192.168.1.24
//   macOS:    ipconfig getifaddr en0
//
// then start the API bound to all interfaces so the phone can reach it:
//   uvicorn app.main:app --host 0.0.0.0 --port 8000
//
// Both devices must be on the same Wi-Fi, and Windows Firewall must allow
// inbound :8000 (it prompts the first time; if you missed it, allow python.exe).
//
// Here this is actually a Tailscale IP, not a plain LAN IP -- backend and phone
// are reached over Tailscale, not local Wi-Fi. Confirm this is still correct
// with `tailscale ip -4` on the machine running uvicorn before assuming it's stale.

const LAN_IP = '100.108.18.20'; // only used if no EXPO_PUBLIC_API_BASE_URL is set

// Read from a gitignored .env at the repo ROOT (see .env.example), so each
// developer points at their own backend without editing this shared file.
//
// The __DEV__ split that used to live here was a trap: a production bundle
// (which is what `eas build` and `eas update` produce) took the else-branch and
// requested the literal string "https://your-production-host". It worked in
// Expo Go via `expo start` -- where __DEV__ is true -- and failed everywhere
// else. One value for both modes removes that whole class of bug.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://freshwise-api-production.up.railway.app';

// Shared key for the hosted API; must match API_KEY in the server's environment.
// Empty is fine against a local backend that has no API_KEY set.
//
// NOT a secret: EXPO_PUBLIC_ values are compiled into the bundle and can be read
// out of the built app. It filters bots and acts as a kill switch; the server's
// rate limiter is what actually caps abuse.
export const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';
export const API_KEY_HEADER = 'X-API-Key';

// Header carrying the client-generated device UUID. Must match DEVICE_ID_HEADER
// in the backend's .env (default X-Device-Id). There is no login anywhere in
// this app -- this header IS the identity.
export const DEVICE_ID_HEADER = 'X-Device-Id';

export const REQUEST_TIMEOUT_MS = 10_000;