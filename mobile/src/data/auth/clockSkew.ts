import type { SessionStore } from './sessionStore';

/**
 * The device's clock against the auth server's, and a session's expiry read in
 * the device's time.
 *
 * **Measured from the live logs, 2026-09-30.** One account's client sent 35
 * token refreshes in six seconds, three times in half an hour, until Supabase
 * answered 429 — and after each, the next thing it did was sign in again.
 * Reproduced against the real auth client (`@supabase/auth-js` 2.112): with
 * the device's clock an hour fast, forty API requests made thirty-one
 * refreshes and the last ten found no session at all.
 *
 * The chain:
 *
 *  1. A token response carries `expires_at` in the **server's** time, and the
 *     client stores it as it came.
 *  2. The client calls a session expired when `expires_at` is within ninety
 *     seconds of **`Date.now()`** — the device's time (`EXPIRY_MARGIN_MS`).
 *  3. So on a clock more than about an hour fast, every token is expired the
 *     moment it arrives, and `getSession()` — which `getAccessToken` calls
 *     before every request — refreshes every time, until the server refuses.
 *  4. A refused refresh of a token that *looks* expired removes the session.
 *     The musician is signed out, signs in, and it starts again.
 *
 * A clock an hour slow fails the other way: a token the server has expired
 * still looks fresh, the backend answers 401, and `apiFetch` signs out on 401.
 *
 * A phone on manual time across a clock change is an hour out. So this module
 * learns the difference from each token response — the server says when it
 * issued the token, `expires_at - expires_in` — and hands the auth client its
 * stored session with `expires_at` moved into the device's time. The client's
 * arithmetic is then right on any clock.
 *
 * **Nothing changes on a clock within `SKEW_TOLERANCE_MS`**, which is every
 * clock set automatically. The correction only exists for the ones that are
 * not.
 */

/** A difference under a minute is network time and rounding, not a wrong clock. */
export const SKEW_TOLERANCE_MS = 60_000;

/**
 * Where the server's own `expires_at` is kept on a corrected session, so a
 * session the client writes back after reading it is never corrected twice.
 */
const SERVER_EXPIRES_AT = 'server_expires_at';

/** Device time minus server time, in milliseconds; null until a response has said. */
let skewMs: number | null = null;

/**
 * The device's clock minus the server's, from a token response that has just
 * arrived — or nothing, for a body that is not one. `receivedAt` is the
 * device's time on arrival; the response is fresh, so the gap between the two
 * is the clocks, give or take the request's own flight time.
 */
export function recordTokenResponse(body: unknown, receivedAt: number = Date.now()): void {
  if (!body || typeof body !== 'object') return;
  const { expires_at: expiresAt, expires_in: expiresIn } = body as Record<string, unknown>;
  if (typeof expiresAt !== 'number' || typeof expiresIn !== 'number') return;
  skewMs = receivedAt - (expiresAt - expiresIn) * 1000;
}

/** The correction in force: zero until measured, and zero within tolerance. */
export function clockSkewMs(): number {
  return skewMs !== null && Math.abs(skewMs) >= SKEW_TOLERANCE_MS ? skewMs : 0;
}

/**
 * A stored session with its `expires_at` in the device's time. Anything that
 * is not a session — another key's value, unreadable JSON, nothing — passes
 * through untouched, as does every session on a clock that is right.
 */
export function correctStoredSession(value: string | null, skew: number = clockSkewMs()): string | null {
  if (value === null) return null;
  let session: unknown;
  try {
    session = JSON.parse(value);
  } catch {
    return value;
  }
  if (!session || typeof session !== 'object') return value;
  const fields = session as Record<string, unknown>;
  const stored = fields[SERVER_EXPIRES_AT] ?? fields.expires_at;
  if (typeof stored !== 'number' || typeof fields.access_token !== 'string') return value;
  if (skew === 0 && fields[SERVER_EXPIRES_AT] === undefined) return value;
  return JSON.stringify({
    ...fields,
    expires_at: stored + Math.round(skew / 1000),
    [SERVER_EXPIRES_AT]: stored,
  });
}

/**
 * The auth client's store, answering with sessions in the device's time.
 * Writes go through as they come: what is kept on disk is the server's.
 */
export function clockAwareStore(store: SessionStore): SessionStore {
  return {
    getItem: async (key) => correctStoredSession(await store.getItem(key)),
    setItem: (key, value) => store.setItem(key, value),
    removeItem: (key) => store.removeItem(key),
  };
}

/**
 * `fetch`, reading the clocks off every auth response that carries a session.
 * The body is read from a clone, before the response is handed back, so the
 * difference is known by the time the auth client stores the session and
 * reads it again.
 */
export async function clockAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (response.ok && url.includes('/auth/v1/')) {
    const receivedAt = Date.now();
    try {
      recordTokenResponse(await response.clone().json(), receivedAt);
    } catch {
      // Not JSON, or a body that cannot be cloned: nothing to learn from it,
      // and the auth client reads the original either way.
    }
  }
  return response;
}

/**
 * @test-seam the measured difference lives for the life of the process, and a
 * suite cannot test an app that restarts — which forgets it and has to learn
 * it again — without a way to put it back.
 */
export function resetClockSkewForTests(): void {
  skewMs = null;
}
