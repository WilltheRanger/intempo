/**
 * A Supabase auth listener that cannot fail the call that notified it.
 *
 * **`onAuthStateChange` callbacks are awaited by the caller.**
 * `GoTrueClient._notifyAllSubscribers` runs every subscriber, collects what
 * they threw and **rethrows the first one** — and `signInWithPassword` notifies
 * *inside* itself, after saving the session and before returning. So a listener
 * that throws does not merely fail: it turns a sign-in the server granted into
 * a sign-in the musician is told failed, with the session already on disk.
 *
 * This app has two listeners, `useAuthStatus` and `startLibraryCache`, and they
 * are notified in registration order — which means the second one throwing also
 * costs the first one nothing, and the first one throwing costs the sign-in
 * everything. Neither has any business deciding whether a sign-in succeeded.
 *
 * **Swallowed, not logged.** `mobile/` has no logging facility on purpose
 * (`CLAUDE.md` §1 rule 4) and `no-console` is an error here. What a swallowed
 * throw costs is bounded by what these listeners do: set a status, and start or
 * stop a cache. The app's next auth event sets both again.
 */
export function isolatedListener<A extends unknown[]>(
  listener: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    try {
      listener(...args);
    } catch {
      // See above: a listener is a spectator, never a vote on the sign-in.
    }
  };
}
