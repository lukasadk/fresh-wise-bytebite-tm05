// Thin fetch wrapper for the FreshWise FastAPI + Postgres backend.
// Reached over Tailscale -- see backend/README.md for how to point this at your
// teammate's actual machine (http vs https, which IP). "localhost" only works if
// the API is running on the same physical device as the app, which it usually isn't.
import { getDeviceId } from './device';

// Set per-developer in a gitignored .env at the repo ROOT (see .env.example), so
// nobody has to edit this file to point at their own backend -- and two people
// doing so no longer collide in git. Falls back to the shared Tailscale host
// when no .env is present, so existing setups keep working untouched.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://freshwise-api-production.up.railway.app';

// Every authenticated route needs this -- see backend/README.md's "Identity model".
const DEVICE_ID_HEADER = 'X-Device-Id';

// Shared key for a publicly-hosted API; must match API_KEY in the server's
// environment. Empty is fine locally -- the backend only enforces it when its
// own API_KEY is set, so leaving this unset changes nothing on the tailnet.
//
// NOT a secret. EXPO_PUBLIC_ values are compiled into the JS bundle and can be
// read out of the built app. Keeping it in .env keeps it off GitHub, which is
// worth doing, but treat it as a scanner filter and a kill switch -- the rate
// limiter is what actually caps abuse.
const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';

// fetch() has no timeout of its own, so an unreachable host hangs until the
// platform's default (often a minute or more). That reads as a frozen app
// rather than an error -- and it's the exact symptom of a wrong
// EXPO_PUBLIC_API_BASE_URL, which is the most likely thing to be wrong.
const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const deviceId = await getDeviceId();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      // `...options` FIRST, headers after. The other way round, any caller
      // passing its own `headers` would replace this object wholesale and
      // silently drop the device id and API key -- every request then 400s or
      // 401s for no visible reason. No caller does that today; this makes it
      // impossible rather than merely unlikely.
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        [DEVICE_ID_HEADER]: deviceId,
        ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
        ...(options?.headers as Record<string, string> | undefined),
      },
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new ApiError(
        `No response from ${API_BASE_URL} after ${REQUEST_TIMEOUT_MS / 1000}s. ` +
          'Check EXPO_PUBLIC_API_BASE_URL and that the API is running.',
        0,
      );
    }
    throw new ApiError(
      `Can't reach ${API_BASE_URL}. On a phone, "localhost" means the phone ` +
        'itself -- set EXPO_PUBLIC_API_BASE_URL to your machine\'s LAN IP or the hosted URL.',
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let message = raw || response.statusText;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.detail) {
        message = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
      }
    } catch {
      // Body wasn't JSON -- keep the raw text.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
};