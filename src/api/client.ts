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

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
