// Thin fetch wrapper for the FreshWise FastAPI + Postgres backend.
// Reached over Tailscale -- see backend/README.md for how to point this at your
// teammate's actual machine (http vs https, which IP). "localhost" only works if
// the API is running on the same physical device as the app, which it usually isn't.
import { getDeviceId } from './device';

// URL and key come from src/api/config.ts -- imported, not redeclared. Two
// modules each holding their own base URL is exactly what let the app request
// "https://your-production-host" from one wrapper while the other was correctly
// pointed at Railway. One definition, one place to change it.
//
// The key is NOT a secret: EXPO_PUBLIC_ values are compiled into the bundle and
// can be read out of the built app. It filters bots and acts as a kill switch;
// the server's rate limiter is what actually caps abuse.
import { API_BASE_URL, API_KEY, API_KEY_HEADER, DEVICE_ID_HEADER } from '../api/config';

// Re-exported so existing importers of `API_BASE_URL` from this module keep working.
export { API_BASE_URL };

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
        ...(API_KEY ? { [API_KEY_HEADER]: API_KEY } : {}),
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