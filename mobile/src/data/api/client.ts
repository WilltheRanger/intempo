import { getAccessToken, signOut } from '../auth/session';

/**
 * What the musician is told when the session is the problem.
 *
 * One sentence, used for both halves of the same situation — no token to send,
 * and a token the server rejected — because they are indistinguishable from
 * the outside and the remedy is the same.
 */
const SESSION_ENDED = 'Your session has ended. Sign in again.';

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
    // No token means the session is gone — expired past refresh, or signed out
    // in another tab. Sending the request anyway is what this used to do, and
    // the backend answered "Missing bearer token", which screens rendered as
    // "check your connection": an expired session reported as a network fault,
    // with no way for the musician to act on it.
    if (!token) {
      // Sign out, don't just report. A refresh that failed past recovery leaves
      // the stored session unusable while `onAuthStateChange` may never fire —
      // so the app would sit on a screen showing an error about a session the
      // gate still believes in. Clearing it returns the musician to sign-in,
      // which is the only thing that actually helps, and is what "your session
      // has ended" was asking them to do by hand.
      await signOut().catch(() => {
        // Already gone. The throw below still stands.
      });
      throw new ApiError(401, path, SESSION_ENDED);
    }
    requestHeaders.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    // A rejected token is not retryable and not the caller's problem to
    // interpret. Clearing the session makes `onAuthStateChange` fire, which
    // returns the app to the sign-in screen instead of leaving every query
    // failing against a credential that will never work again.
    if (response.status === 401 && authenticated) {
      await signOut().catch(() => {
        // Already gone, or storage refused. The throw below still stands.
      });
      throw new ApiError(401, path, SESSION_ENDED);
    }
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
