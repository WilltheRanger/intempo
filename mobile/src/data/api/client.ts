import { getAccessToken } from '../auth/session';

/**
 * Base URL for the FastAPI backend. Override per environment with
 * `EXPO_PUBLIC_API_BASE_URL`; the default matches `uv run uvicorn` locally.
 */
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set false for the rare unauthenticated call (only `/v1/health` today). */
  authenticated?: boolean;
}

/**
 * Single entry point for the backend. Attaches the Supabase bearer token,
 * serialises JSON bodies, and turns non-2xx responses into `ApiError`.
 *
 * Carries over the shape of `frontend/src/lib/api.ts`, which was the only
 * frontend logic in the repo before this rebuild.
 */
export async function apiFetch<T>(
  path: string,
  { body, authenticated = true, headers, ...init }: ApiFetchOptions = {},
): Promise<T> {
  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  if (authenticated) {
    const token = await getAccessToken();
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      path,
      await readErrorDetail(response, path),
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** FastAPI returns `{ "detail": "..." }`; fall back to the status line. */
async function readErrorDetail(
  response: Response,
  path: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === 'string') {
      return payload.detail;
    }
  } catch {
    // Body wasn't JSON. Fall through.
  }
  return `Request failed (${response.status}): ${path}`;
}
