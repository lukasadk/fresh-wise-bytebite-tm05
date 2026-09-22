// Thin fetch wrapper: attaches the device header, applies a timeout, and turns
// FastAPI error bodies into readable messages.
//
// Everything in src/api/ goes through this, so retry/auth/logging changes
// happen in one place.

import {
  API_BASE_URL,
  API_KEY,
  API_KEY_HEADER,
  DEVICE_ID_HEADER,
  REQUEST_TIMEOUT_MS,
} from './config';
import { Platform } from 'react-native';
import { getDeviceId } from './device';

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** FastAPI returns errors as {detail: "..."} or, for validation failures,
 *  {detail: [{loc, msg, ...}]}. Flatten both into one readable string so the
 *  UI can show something useful instead of "[object Object]". */
function readDetail(body: any, fallback: string): string {
  const d = body?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d
      .map((e) => {
        const field = Array.isArray(e?.loc) ? e.loc.filter((p: any) => p !== 'body').join('.') : '';
        return field ? `${field}: ${e?.msg ?? ''}` : e?.msg ?? '';
      })
      .filter(Boolean)
      .join('; ');
  }
  return fallback;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Reference endpoints (/v1/reference/*) carry no user data and don't need
   *  the device header. Harmless to send, but skipping it makes the intent clear. */
  anonymous?: boolean;
  signal?: AbortSignal;
};

// Detail string the backend's get_current_user() returns (backend/app/deps.py)
// when this device UUID has no profile row yet.
export const NO_PROFILE_DETAIL = 'No profile for this device UUID yet';

// One shared in-flight registration, so ten screens hitting the 404 at once
// trigger ONE POST /v1/users, not ten. Cleared on failure so the next request
// tries again instead of being stuck with a rejected promise forever.
let profileRegistration: Promise<void> | null = null;

/** Also used by src/data/api.ts's wrapper, so both share one registration. */
export function ensureProfile(): Promise<void> {
  if (!profileRegistration) {
    profileRegistration = (async () => {
      const user_id = await getDeviceId();
      await requestOnce('/v1/users', { method: 'POST', body: { user_id, household_size: 1 } });
    })().catch((err) => {
      profileRegistration = null;
      throw err;
    });
  }
  return profileRegistration;
}

/** Every API call goes through here. Self-heals a missing device profile:
 *  App.tsx registers the device once at startup, but only fire-and-forget --
 *  if that single POST /v1/users failed (slow or dropped connection, the
 *  hosted server waking up, the 10s timeout), every later request would 404
 *  with "No profile for this device UUID yet" for the rest of the session.
 *  Now the first such 404 registers the device (get-or-create, so harmless if
 *  it already exists) and retries the original request once. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await requestOnce<T>(path, options);
  } catch (err) {
    const isMissingProfile =
      err instanceof ApiError &&
      err.status === 404 &&
      err.message.startsWith(NO_PROFILE_DETAIL) &&
      path !== '/v1/users';
    if (!isMissingProfile || options.signal?.aborted) throw err;
    await ensureProfile();
    return requestOnce<T>(path, options);
  }
}

async function requestOnce<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous = false, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!anonymous) headers[DEVICE_ID_HEADER] = await getDeviceId();
  // Sent on EVERY request, including the anonymous reference lookups -- the
  // server checks the key as middleware, ahead of any per-route logic.
  if (API_KEY) headers[API_KEY_HEADER] = API_KEY;

  // Abort on timeout, but respect a caller-supplied signal too (screens pass
  // one on unmount so a slow request can't set state after teardown).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => controller.abort());

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
      throw new ApiError(0, `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    // The overwhelmingly common cause in dev is API_BASE_URL pointing at
    // localhost from a phone, so say so rather than just "Network request failed".
    // In a browser (expo start --web) the usual cause is different: the server
    // is up but its CORS settings don't allow this page's origin, and the
    // browser reports that as the same generic network failure.
    if (Platform.OS === 'web') {
      throw new ApiError(
        0,
        `Can't reach the API at ${API_BASE_URL} from the browser. If the app works on ` +
          `your phone, the server is probably blocking this web origin ` +
          `(${typeof window !== 'undefined' ? window.location.origin : 'this page'}) -- ` +
          `add it to CORS_ORIGINS on the backend.`,
      );
    }
    throw new ApiError(
      0,
      `Can't reach the API at ${API_BASE_URL}. On a phone or emulator, "localhost" ` +
        `means the device itself -- set LAN_IP in src/api/config.ts to your computer's ` +
        `IP and start uvicorn with --host 0.0.0.0.`,
    );
  }
  clearTimeout(timer);

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed = text ? safeJson(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, readDetail(parsed, `HTTP ${response.status}`), parsed);
  }
  return parsed as T;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text.slice(0, 200) };
  }
}
