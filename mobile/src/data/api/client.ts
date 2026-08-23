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
    /**
     * The parsed `detail`, when the server sent a structured one.
     *
     * FastAPI's `detail` is usually a string, and for those this is the same
     * text as `message`. Some are objects — the tier-limit 403 carries a code,
     * the limit, the count and a reset date, deliberately, *because the client
     * has to act on it*. That body used to be thrown away here: anything that
     * wasn't a string fell through to "Request failed (403)", so the one error
     * the backend took trouble to make actionable arrived as the least
     * informative string in the app.
     */
    readonly detail: unknown = message,
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

  const response = await send(path, {
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
    const { message, detail } = await readError(response, path);
    throw new ApiError(response.status, path, message, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * How long to wait before deciding the request is not coming back.
 *
 * Forty-five seconds, which is far longer than any endpoint should need.
 *
 * It is deliberately **not** long enough to cover a cold start. The host warns
 * that waking it "can delay requests by 50 seconds or more", and stretching
 * this past that would make a genuinely dead connection take over a minute to
 * report. `send` retries a repeatable request instead, which handles the nap
 * without punishing every other failure for it.
 *
 * This is a backstop against a connection that has died silently, not a
 * latency budget. Long work — reading a photographed page — is not held on a
 * connection at all any more; it is a row the app polls.
 */
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Methods that can be sent twice without meaning it twice.
 *
 * The whole retry below turns on this. A GET that times out has changed
 * nothing, so asking again costs a request. A POST that times out may have
 * been received, run, and had only its *answer* lost — resending it would
 * submit a second take, or create a second piece, and the musician would find
 * a duplicate they never made. Silence is the better failure there.
 */
const REPEATABLE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * `fetch`, with a deadline and an error a person can read.
 *
 * A `fetch` that never completes rejects with the platform's own wording, and
 * on iOS Safari that wording is **"Load failed"** — which is what a musician
 * saw when a scan hit a request that had been held open too long. It names no
 * cause and suggests no remedy, and it was reaching the screen verbatim
 * because nothing here caught it.
 *
 * Every network-level failure now arrives as an `ApiError` with status 0.
 * Zero rather than a plausible 502: no server answered, so attributing a
 * status to one would be inventing a fact about a conversation that never
 * happened.
 *
 * **A repeatable request is tried once more before that.** The host sleeps
 * when idle and warns that waking it "can delay requests by 50 seconds or
 * more" — longer than the deadline here, which means the first request after
 * any quiet period was reliably a failure the musician had to retry by hand.
 * The attempt that times out is also the attempt that *wakes the host*, so the
 * second one lands on a running server and returns in the ordinary time.
 *
 * Not a general retry policy. One extra attempt, only for methods that can be
 * repeated, only when nothing was heard back at all — a request that got a 500
 * is answered and is not tried again.
 */
async function send(path: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const attempts = REPEATABLE.has(method) ? 2 : 1;

  let lastTimedOut = false;
  let lastCause: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } catch (cause) {
      lastTimedOut = controller.signal.aborted;
      lastCause = cause;
    } finally {
      clearTimeout(deadline);
    }
  }

  if (lastTimedOut) {
    throw new ApiError(
      0,
      path,
      'The server took too long to answer. It may be waking up — try again in a moment.',
    );
  }
  throw new ApiError(
    0,
    path,
    'Could not reach the server. Check your connection and try again.',
    lastCause,
  );
}

/**
 * FastAPI's error body, as both a sentence and the raw thing.
 *
 * The body is read **once** — a `Response` can only be consumed once, so
 * parsing it twice to get the two halves separately would throw on the second
 * read.
 */
async function readError(
  response: Response,
  path: string,
): Promise<{ message: string; detail: unknown }> {
  const fallback = `Request failed (${response.status}): ${path}`;
  try {
    const payload = (await response.json()) as { detail?: unknown };
    const { detail } = payload;
    if (typeof detail === 'string') {
      return { message: detail, detail };
    }
    // Structured: keep it whole, and leave the sentence to whoever understands
    // the shape. See `describeTierLimit`.
    return { message: fallback, detail: detail ?? payload };
  } catch {
    // Body wasn't JSON.
    return { message: fallback, detail: null };
  }
}
