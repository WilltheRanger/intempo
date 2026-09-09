/**
 * Which of a screen's three states to draw, given what a query came back with.
 *
 * **Because a failed refetch does not mean there is nothing to show.** Measured
 * against `@tanstack/query-core` rather than assumed: a query that has data and
 * whose *next* fetch rejects reports `status: 'error'`, `isError: true` — and
 * still holds the data. Seven screens read that `isError` and drew a full-page
 * "Couldn't load…" over a library, a piece, a verdict or a profile they were
 * already holding.
 *
 * It has always been reachable — walk into a lift with the library open and tap
 * a piece — and it became the normal case the day the repertoire started being
 * restored from the device (`data/cache/persistCache.ts`), because then the
 * refetch behind a *restored* screen fails for every musician with no signal.
 * Persisting the library and then refusing to draw it would have been a feature
 * that cancelled itself out.
 *
 * **One module because it was seven near-copies.** `isError`, `isError || !take`
 * and `isError || !musician` — three spellings of one rule, each free to be
 * edited without the others, none of them tested, since `CLAUDE.md` is explicit
 * that a rule inside a `.tsx` is a rule nothing checks.
 *
 * **What is given up, and why it is affordable.** The error state carries the
 * "Try again" button; showing the content instead means that button is not on
 * the screen. `createQueryClient` leaves `refetchOnReconnect` at its default, so
 * the query re-runs by itself the moment the connection is back — the retry
 * that mattered was never the tap.
 *
 * **What is deliberately not here.** Nothing tells the musician that what they
 * are looking at is what was last fetched. That is copy and a visual treatment,
 * so it is the owner's call under `CLAUDE.md` §2. The screens are honest
 * without it: they say less, never something untrue.
 */
export type LoadState =
  /** Nothing has arrived yet. Skeleton. */
  | 'loading'
  /** Nothing arrived and nothing is coming. The failure state. */
  | 'unavailable'
  /** There is something to draw — even if the most recent attempt failed. */
  | 'ready';

export interface LoadInputs {
  /** `isError` from the query. True after a failure, with or without data. */
  isError: boolean;
  /**
   * Whether the query has an answer at all — `data !== undefined`, always.
   *
   * **Not "is the answer worth drawing".** `null` is an answer: on a detail
   * screen it means *this piece is gone*, on Today it means *you have not
   * started anything yet*, and those are different screens. Deciding that here
   * would get one of them wrong — the first draft of this module took
   * `piece != null` and would have left a deleted piece loading for ever,
   * because a successful `null` is neither an error nor pending. So `null`
   * resolves to `ready` and the screen, which is the only thing that knows what
   * its own `null` means, handles it in the branch it already had.
   */
  hasData: boolean;
}

export function loadStateFor({ isError, hasData }: LoadInputs): LoadState {
  if (hasData) {
    // Before the error check, and that ordering is the whole point.
    return 'ready';
  }
  return isError ? 'unavailable' : 'loading';
}
