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

const LAN_IP = '100.108.18.20'; // <-- CHANGE THIS to your machine's IP

export const API_BASE_URL = __DEV__
  ? `http://${LAN_IP}:8000`
  : 'https://your-production-host'; // set when the NAS/host is decided

// Header carrying the client-generated device UUID. Must match DEVICE_ID_HEADER
// in the backend's .env (default X-Device-Id). There is no login anywhere in
// this app -- this header IS the identity.
export const DEVICE_ID_HEADER = 'X-Device-Id';

export const REQUEST_TIMEOUT_MS = 10_000;