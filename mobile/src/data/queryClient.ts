import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api/client';

/**
 * How long a fetched answer is treated as current.
 *
 * **Without this every screen refetched from scratch every time it was
 * opened.** React Query's default is zero, so a query is stale the instant it
 * resolves: tapping Library, then Today, then Library again is three full
 * round trips and three skeletons, for a repertoire that has not changed in
 * between. Against a host that costs two serial round trips per authenticated
 * request, that is the app feeling slow everywhere at once, and it is entirely
 * self-inflicted.
 *
 * Thirty seconds. Long enough that moving around the app is instant, short
 * enough that nothing here goes visibly out of date — and every write already
 * invalidates what it changed, which is what actually keeps these screens
 * honest. Staleness is the fallback, not the mechanism.
 *
 * It does not touch polling: `usePiece` drives a page being read with
 * `refetchInterval`, which ignores this.
 */
export const STALE_TIME_MS = 30_000;

/**
 * Whether to ask again after a failure.
 *
 * **Never for an `ApiError`, and the reason is that the retrying already
 * happened.** `send` gives a repeatable request two attempts of
 * `REQUEST_TIMEOUT_MS` before it reports anything, so a GET against a dead
 * connection has already spent ninety seconds by the time it throws — and
 * React Query's default of one retry ran the whole `queryFn` again, wake and
 * all, for **three minutes** of a screen showing a skeleton before it showed an
 * error. A musician waiting three minutes is not waiting, they have closed the
 * app.
 *
 * Anything with a status was answered, and answered the same way twice is the
 * same answer: a 404 is not going to become a 200, and a 403 over the tier
 * limit is a thing to render rather than to ask about again.
 *
 * **Except the three that mean "not now".** 502, 503 and 504 are the statuses
 * whose entire meaning is that the answer is expected to change — an upstream
 * that is restarting, a dependency briefly unreachable, a gateway that gave
 * up waiting. Sweeping them in with 404 was an over-generalisation of a rule
 * written about something else, and it stopped being harmless the day
 * `auth.py` started answering **503** for a key server it could not reach:
 * a blip of a second or two now renders as a failed screen instead of being
 * ridden out.
 *
 * **500 is deliberately not in the list.** A server error that is not
 * explicitly "temporarily unavailable" is usually a bug, and a bug answers the
 * same way every time; retrying it spends a musician's wait on a result that
 * is not coming.
 *
 * **The cost is small precisely because these arrive fast.** The paragraph
 * above is about a *timeout*, where one more attempt costs ninety seconds. A
 * 503 is a response — it lands in the time a request takes — so two more
 * attempts at React Query's default backoff is about three seconds, not three
 * minutes. That difference is the whole reason this exception is affordable
 * and the one above is not.
 *
 * Reads only. `mutations.retry` stays `false`, and the comment there says why:
 * a POST that timed out may have been received and run, and asking again
 * submits a second take.
 *
 * A non-`ApiError` gets one retry. That is the unfamiliar failure — something
 * threw that this layer does not recognise — and one more attempt is a fair
 * price for a class of error we cannot reason about.
 */
const TRY_AGAIN_SHORTLY = new Set([502, 503, 504]);

/** How many extra goes a "not now" answer is worth. See the note on cost. */
const RETRIES_WHILE_UNAVAILABLE = 2;

export function retryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    return (
      TRY_AGAIN_SHORTLY.has(error.status) &&
      failureCount < RETRIES_WHILE_UNAVAILABLE
    );
  }
  return failureCount < 1;
}

/**
 * The app's one query client.
 *
 * **A module rather than a `const` in `App.tsx`**, because everything here is a
 * rule and `CLAUDE.md` is explicit that a rule inside a `.tsx` is a rule
 * nothing checks. Both of these were: the retry policy that stands between a
 * musician and a three-minute skeleton, and `mutations.retry`, whose comment
 * describes the take submitted twice that a regression would produce. Neither
 * had a test, and neither is visible in a screenshot or a walk — a duplicate
 * take needs a timed-out POST that the server actually ran, which nothing in
 * this repository can stage.
 *
 * A factory rather than a singleton so a test gets its own cache. `App.tsx`
 * calls it once at module scope, which is the same client it always had.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: retryQuery,
        staleTime: STALE_TIME_MS,
        refetchOnWindowFocus: false,
      },
      mutations: {
        // A write is never repeated automatically. `send` will not retry one
        // either, and for the same reason: a POST that timed out may have been
        // received and run, with only its answer lost — asking again submits a
        // second take, or creates a second piece, and the musician finds a
        // duplicate they never made.
        retry: false,
      },
    },
  });
}
