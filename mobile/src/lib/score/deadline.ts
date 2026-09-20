/**
 * A bound on a stage of playback, so a stall becomes a sentence.
 *
 * **What this fixes is a spinner with no end.** `beginSampledPlayback` calls
 * `options.onLoading?.(true)` and then awaits a download and a render with
 * nothing bounding either. `listenFailure` already has the right words for a
 * load that fails — "Couldn't load the instrument sound. Check your connection
 * and tap Listen to retry." — and they could not be reached, because a fetch
 * that stalls does not reject. It hangs, and so did the button.
 *
 * **What it does not fix is slowness**, and the distinction is worth keeping
 * straight. The instrument banks are 0.6–1 MB and `ListenButton` already warms
 * them while the musician reads the page, which is what makes a tap quick. A
 * deadline cannot make a download faster; it only decides how long to wait
 * before admitting it is not coming.
 *
 * Generous on purpose, for that reason. The failure mode being removed is an
 * infinite wait, not a long one, and a musician on poor cellular who would
 * have had sound at twenty seconds is worse off if this refuses at ten. When
 * in doubt this waits.
 */

/** A stage that never finished. Thrown so `listenFailure` can word it. */
export class TookTooLong extends Error {
  constructor(readonly waitedMs: number) {
    super(`Gave up after ${Math.round(waitedMs / 1000)}s`);
    this.name = 'TookTooLong';
  }
}

/**
 * Loading the instrument bank: a download plus a parse.
 *
 * Thirty seconds is long for a megabyte and deliberately so — see the header.
 * This is the number that decides when "still coming" becomes "not coming".
 */
export const LOAD_DEADLINE_MS = 30_000;

/**
 * Rendering the passage to samples.
 *
 * Synthesis runs 23–45x faster than real time, so even a ten minute passage is
 * seconds of work. A wait this long means something has gone wrong rather than
 * something being big, and `renderSoundfont` refuses over-long passages itself
 * with advice of its own before this could fire.
 */
export const RENDER_DEADLINE_MS = 30_000;

/**
 * Resolve `work`, or reject with {@link TookTooLong} once `ms` has passed.
 *
 * The timer is always cleared, including on the happy path: a pending
 * `setTimeout` for thirty seconds after every successful Listen would keep the
 * page awake for no reason and, under fake timers in a suite, hang a test that
 * had already finished.
 *
 * **The work is not cancelled**, because it cannot be — a `fetch` already in
 * flight has no handle here. This decides what the caller waits for, not what
 * the browser does. The caller's own `stopped` flag is what makes a superseded
 * load harmless.
 */
export function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TookTooLong(ms)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer)) as Promise<T>;
}
