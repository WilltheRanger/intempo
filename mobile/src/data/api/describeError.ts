import { ApiError, SERVER_FAULT } from './client';

/**
 * What to tell someone when a screen could not load.
 *
 * Five screens carried the same hardcoded line — *"Check your connection and
 * try again"* — for every failure there is. That is right for exactly one of
 * them. It told a musician whose session had expired to check their wifi, and
 * told them the same thing when the server returned a 500, so the one piece of
 * advice the app ever gave was usually wrong and never actionable.
 *
 * `apiFetch` already knows which of these happened; it just had nowhere to say
 * so, because the screens threw its message away and substituted their own.
 *
 * A network failure is still the default, and deliberately: `fetch` rejects
 * with a bare `TypeError` for a dropped connection, a DNS failure and a CORS
 * refusal alike, so anything that isn't a recognisable `ApiError` genuinely is
 * "something between here and the server", and connection is the useful guess.
 */
export function describeLoadError(error: unknown): string {
  if (error instanceof ApiError) {
    /*
     * Status 0 is minted **here**, never by a server — `Response.status` is
     * never 0 for a response whose body we read — and every one of the four
     * places that mints it writes a sentence for a musician: the session that
     * could not be read in time, the body that stopped mid-flight, the host
     * that is waking up, and the connection that never opened.
     *
     * They were all collapsed into "Check your connection and try again." That
     * is the exact substitution this module was written to stop, and it was
     * worst on the one that matters most: this app's host sleeps, so **"It may
     * be waking up — try again in a moment"** is the most common failure a
     * musician meets, and every screen sent them to look at their wifi
     * instead. `RESPONSE_STALLED` says in its own comment that "could not
     * reach the server" would send someone to check a connection that
     * demonstrably works — and then a screen said exactly that.
     */
    if (error.status === 0) {
      return error.message;
    }
    if (error.status === 401) {
      return 'Your session has ended. Sign in again.';
    }
    if (error.status === 403) {
      return "This isn't yours to open.";
    }
    if (error.status === 404) {
      return "It isn't there any more — it may have been removed.";
    }
    if (error.status === 429) {
      /*
       * The server's own sentence, like status 0 above — and for the same
       * reason. A 429 here is the reading-rate guard in `services/reading_rate`
       * refusing to start another vision-model read, and it answers with a line
       * already written for a musician *and* a `Retry-After` naming the wait.
       *
       * The fallthrough at the bottom of this function would have said "Check
       * your connection and try again", which is the exact substitution this
       * module exists to stop: the connection is demonstrably fine — it carried
       * the refusal — and the one thing a musician could do about it is the one
       * thing that sentence doesn't mention, which is wait a moment.
       */
      return error.message;
    }
    if (error.status >= 500) {
      // Explicitly not the musician's problem to solve, and explicitly not
      // worth them retrying in the next second.
      //
      // Imported rather than written here, so a read and a write cannot come
      // to disagree about what a 500 means: `client.ts` mints the same
      // sentence when a server error arrives with no readable body, and two
      // copies of one sentence is how the second one drifts.
      return SERVER_FAULT;
    }
  }
  return 'Check your connection and try again.';
}
