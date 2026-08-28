// Thin fetch wrapper for the FreshWise FastAPI + Postgres backend.
// Reached over Tailscale -- see backend/README.md for how to point this at your
// teammate's actual machine (http vs https, which IP). "localhost" only works if
// the API is running on the same physical device as the app, which it usually isn't.
import { getDeviceId } from './device';

export const API_BASE_URL = 'http://100.108.18.20:8000';

// Every authenticated route needs this -- see backend/README.md's "Identity model".
const DEVICE_ID_HEADER = 'X-Device-Id';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const deviceId = await getDeviceId();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      [DEVICE_ID_HEADER]: deviceId,
    },
    ...options,
  });

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