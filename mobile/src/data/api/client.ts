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
    // Both at once: the session read is local and the wake is not, so there is
    // nothing to gain from doing them in order. `warmApi` never rejects, so
    // the only thing this can throw is the token deadline.
    const [, token] = await Promise.all([
      warmApi(),
      withDeadline(
        getAccessToken(),
        TOKEN_TIMEOUT_MS,
        () => new ApiError(0, path, SESSION_UNREADABLE),
      ),
    ]);
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

  const { response, signal, release } = await send(path, {
    ...init,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  try {
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
  } catch (cause) {
    // The deadline fired while the body was still coming. Checked on the
    // signal rather than on the error's shape, because a body that is simply
    // not JSON throws here too and is a different fault with a different fix —
    // and it should keep propagating exactly as it did before.
    if (signal.aborted && !(cause instanceof ApiError)) {
      throw new ApiError(0, path, RESPONSE_STALLED, cause);
    }
    throw cause;
  } finally {
    release();
  }
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
 * How long to give the host to wake up, once, before the first authenticated
 * request of the session.
 *
 * **Every authenticated request costs two serial round trips.** `Authorization`
 * is not a CORS-safelisted header, so the browser sends a preflight `OPTIONS`
 * and waits for it before sending anything else. Measured against the
 * deployment on 2026-08-25: warm, preflight and request land 2 seconds apart
 * and the whole screen loads in 4.
 *
 * Cold, it is fatal, and `send`'s retry cannot help. The thing queued behind
 * the host's 75-second boot is the **browser's** preflight, not our request —
 * we abort it at `REQUEST_TIMEOUT_MS`, so the browser never sends the real one
 * at all, and the retry queues another preflight and aborts that too. The
 * Render log for a cold open is seven `OPTIONS` and not one `GET`.
 *
 * `/v1/health` is unauthenticated, so it carries no `Authorization`, so it is
 * a *simple* request with no preflight — one round trip instead of two, and
 * nothing for the browser to give up on. Waking on that and letting the
 * authenticated traffic follow turns "never completes" into "completes
 * slowly".
 *
 * Long, because it is measured against a documented cold start rather than a
 * latency budget, and because nothing is holding a screen open on it: it is
 * awaited once, and the request it gates was going to wait anyway.
 */
const WAKE_TIMEOUT_MS = 90_000;

/**
 * How long to wait for the bearer token before giving up on the request.
 *
 * **`getAccessToken` is a network call in disguise.** It reads the stored
 * session, and when the access token is near expiry `supabase.auth.getSession`
 * refreshes it over the network first. Awaiting it unbounded — which this did
 * — means every authenticated request can hang *before it is sent*: no request
 * on the wire, no response to time out, no error to render. A screen waiting
 * on it sits on its skeleton forever, because `isPending` never becomes
 * `isError`.
 *
 * `useAuthStatus` already guards the same call with `SESSION_TIMEOUT_MS`, and
 * its comment records what an unguarded one cost: "the whole app into a blank
 * screen with nothing to tap". That guard was only ever applied at boot. This
 * is the same hazard on every request afterwards.
 *
 * Shorter than the request deadline on purpose. This is a local read plus at
 * most one token refresh; if it has not answered in ten seconds it is not
 * going to, and the ten seconds are spent *before* the real request has even
 * started.
 */
const TOKEN_TIMEOUT_MS = 10_000;

/**
 * The session could not be read in time.
 *
 * Deliberately **not** `SESSION_ENDED`. The session may be perfectly valid and
 * simply unreachable, and signing someone out over a slow network would throw
 * away a good session to report a temporary fault.
 */
const SESSION_UNREADABLE =
  'Could not read your session in time. Check your connection and try again.';

/**
 * Headers arrived, then the body stopped.
 *
 * Its own sentence because it is its own failure: the server was reached and
 * did answer, so "could not reach the server" would send someone to check a
 * connection that demonstrably works.
 */
const RESPONSE_STALLED =
  'The server started answering and then stopped. Try again.';

/**
 * Races `work` against a deadline, and always clears the timer.
 *
 * The loser of a `Promise.race` keeps running — that is fine here, it is a
 * session read with nothing to undo. What is not fine is leaving the timer
 * armed: in a test with fake timers, and on a platform that counts pending
 * work, an uncleared deadline outlives the thing it was guarding.
 */
async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
/** The wake currently in flight, shared by everything waiting on it. */
let waking: Promise<void> | null = null;

/**
 * When the API was last known to be awake.
 *
 * Any response proves it — a 500 as much as a 200 — so this is set from
 * `send`, on headers arriving, and not from whether the request succeeded.
 */
let lastContactAt = 0;

/**
 * How long a wake is worth anything for.
 *
 * **The host goes back to sleep, and the wake was only ever done once.** It
 * sleeps after about fifteen minutes idle, and `waking` was a promise that
 * resolved once and then stood for the life of the process — so the wake
 * protected the first screen of a session and nothing after it. Leave the app
 * open through a lesson, come back, and the first request is the one thing the
 * wake exists to prevent: an authenticated request, with a preflight in front
 * of it, queued behind a seventy-five second cold start. We abort ours at
 * `REQUEST_TIMEOUT_MS`, so the browser never sends the real request at all, and
 * the retry queues another preflight and abandons that too. Ninety seconds of a
 * screen that looks frozen, ending in an error, exactly as before the wake was
 * added.
 *
 * Ten minutes, under the fifteen the host allows, so the question is asked
 * again while the answer can still be "yes". Anything that keeps the app busy
 * — the three-second poll of a page being read, a screen being opened —
 * refreshes `lastContactAt`, so this never fires during use and never costs a
 * request. It fires after a pause, which is exactly when the host has been
 * doing the same thing.
 */
const WAKE_GOES_STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * Wakes the host, and never fails.
 *
 * **Fails open, deliberately.** A wake that could not be confirmed must not
 * stop the request that follows: the server may be perfectly awake and the
 * health check merely unlucky, and a gate that turns one failed request into
 * every failed request is worse than the cold start it was added for. The same
 * rule `shouldOnboard` follows, for the same reason.
 *
 * Costs nothing when the API has been heard from recently, which is the common
 * case — every request refreshes that, so during use this returns an
 * already-resolved promise without touching the network.
 *
 * Exported so the app can start it at launch instead of at the first query —
 * the wake is the long pole, and beginning it a second earlier is a second
 * off every screen behind it.
 */
export function warmApi(): Promise<void> {
  // One at a time. Everything that arrives while a wake is in flight waits on
  // that one rather than starting a second — the host is being woken once, and
  // a queue of identical health checks would only lengthen the cold start they
  // are all waiting for.
  if (waking) {
    return waking;
  }
  if (Date.now() - lastContactAt < WAKE_GOES_STALE_AFTER_MS) {
    return Promise.resolve();
  }
  waking = withDeadline(
    apiFetch<unknown>('/v1/health', { authenticated: false }),
    WAKE_TIMEOUT_MS,
    () => new Error('wake timed out'),
  )
    .then(() => undefined)
    // Never rejects, and never holds a bad answer: cleared either way below, so
    // the next request after a failed wake asks again rather than inheriting
    // this one for the life of the process.
    .catch(() => undefined)
    .finally(() => {
      waking = null;
    });
  return waking;
}

interface Sent {
  response: Response;
  /** Armed until `release`, so a body that stalls is aborted too. */
  signal: AbortSignal;
  /** Disarms the deadline. Call once the body is read, or never will be. */
  release: () => void;
}

async function send(path: string, init: RequestInit): Promise<Sent> {
  const method = (init.method ?? 'GET').toUpperCase();
  const attempts = REPEATABLE.has(method) ? 2 : 1;

  let lastTimedOut = false;
  let lastCause: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
      });
      // Headers arrived, so the host is awake — whatever it went on to say.
      // Recorded here rather than on success because a 500 is as much proof of
      // a running server as a 200, and `warmApi` is asking about the server,
      // not about this request.
      lastContactAt = Date.now();
      // **The deadline is not cleared here**, which is the whole point of
      // handing `release` back. `fetch` resolves when the *headers* arrive, so
      // clearing it at this line — which is what this used to do, in a
      // `finally` — left the body to arrive with no deadline at all. A
      // response whose headers land and whose body then stops hangs forever,
      // and forever is not a state any screen in this app renders.
      return {
        response,
        signal: controller.signal,
        release: () => clearTimeout(deadline),
      };
    } catch (cause) {
      clearTimeout(deadline);
      lastTimedOut = controller.signal.aborted;
      lastCause = cause;
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
