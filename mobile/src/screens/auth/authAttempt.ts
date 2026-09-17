/**
 * What to make of a sign-in that threw, or never came back at all.
 *
 * **Two ways a granted session was reported as a failure**, both measured on
 * 2026-09-17 against a musician who was signed in three times by Supabase in
 * twelve seconds and saw the form again each time:
 *
 * - `signInWithPassword` saves the session and notifies its listeners *inside
 *   itself*, before returning. Anything that throws in either step is rethrown
 *   out of the call — so the screen hears "sign-in failed" about a session that
 *   exists. The session is the fact; the exception is a report of one step.
 * - Nothing bounds the call. The store it writes through can stall — on web it
 *   is IndexedDB, whose adapter has no deadline anywhere — and the button then
 *   spins until the musician reloads the page, which is the one thing that
 *   makes it look broken rather than slow.
 *
 * So: ask the session, not the exception. A call that throws or stalls is
 * checked against whether the app is actually signed in, and only what is left
 * after that is a failure worth a sentence.
 *
 * Here rather than in `AuthScreen` because there is no React Native testing
 * library in this project (`DECISIONS.md`, 2026-08-24) — a rule inside a
 * `.tsx` is a rule nothing checks.
 */

/**
 * How long a sign-in may take before the screen stops waiting on it.
 *
 * Twenty seconds. Long enough to cover a cold API and a slow phone — the point
 * is not to catch a slow sign-in but to catch one that will never finish, and
 * being wrong in that direction costs a musician a retry they did not need.
 * `apiFetch` gives a token read ten seconds and the whole request forty-five;
 * this sits between them because a sign-in is one round trip plus a write.
 *
 * The call is not cancelled, only stopped waiting on: if it completes later and
 * a session appears, `useAuthStatus` hears it and replaces the screen anyway.
 */
export const ATTEMPT_DEADLINE_MS = 20_000;

/** Said when the call never came back and no session appeared either. */
export const ATTEMPT_STALLED =
  'That took too long to finish. Check your connection and try again.';

export type Settled<T> =
  /** The call returned. Its own answer is the outcome. */
  | { kind: 'done'; value: T }
  /** It threw or stalled, but the app is signed in. Nothing to report. */
  | { kind: 'signedIn' }
  /** It threw, and there is no session to show for it. */
  | { kind: 'failed'; error: unknown }
  /** It never came back, and there is no session to show for it. */
  | { kind: 'stalled' };

export interface Attempt<T> {
  /** The Supabase call being made. */
  run: () => Promise<T>;
  /**
   * Whether there is a session now — the authority when `run` is unhelpful.
   *
   * Left out by a caller for whom a session is not the point: asking for
   * another confirmation mail succeeds or does not, and being signed in says
   * nothing about which.
   */
  signedIn?: () => Promise<boolean>;
  deadlineMs?: number;
}

/**
 * Runs an auth call and decides what actually happened.
 *
 * `signedIn` is only ever consulted when the call failed to say — a call that
 * returns normally is believed, because it is the one path that has the whole
 * answer (a sign-up awaiting confirmation is not a session and must not be
 * read as one).
 */
export async function settleAuthCall<T>({
  run,
  signedIn = async () => false,
  deadlineMs = ATTEMPT_DEADLINE_MS,
}: Attempt<T>): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = Symbol('stalled');
  try {
    const raced = await Promise.race([
      run().then(
        (value) => ({ value }) as const,
        (error) => ({ error }) as const,
      ),
      new Promise<typeof stalled>((resolve) => {
        timer = setTimeout(() => resolve(stalled), deadlineMs);
      }),
    ]);

    if (raced !== stalled && 'value' in raced) {
      return { kind: 'done', value: raced.value };
    }
    // Either the call threw or it is still out there. Both are questions about
    // the session, and only the session can answer them.
    if (await settledSignedIn(signedIn)) {
      return { kind: 'signedIn' };
    }
    return raced === stalled
      ? { kind: 'stalled' }
      : { kind: 'failed', error: raced.error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks whether there is a session, and treats its own failure as "no".
 *
 * This runs on the failure path of something that has already gone wrong; a
 * throw here would replace a message a musician can act on with one nobody
 * wrote.
 */
async function settledSignedIn(signedIn: () => Promise<boolean>): Promise<boolean> {
  try {
    return await signedIn();
  } catch {
    return false;
  }
}
