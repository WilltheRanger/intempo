import { describeTierLimit } from '../tierLimit';
import { microphonePermissionRecovery } from './permission';
import {
  EmptyRecordingError,
  MicrophonePermissionError,
  MicrophoneUnavailableError,
  type MicrophoneRecovery,
} from './types';

/**
 * What a musician is told when a take does not go through, and whether they
 * are offered another go.
 *
 * **One function because the two answers must agree.** They were two rules in
 * `RecordScreen.tsx`, thirty lines apart, both keyed off
 * `describeTierLimit(error)` and each free to be edited without the other:
 *
 *     const retriable = describeTierLimit(error) === null;
 *     ...
 *     setProblem(messageFor(error));
 *
 * Diverging is not a cosmetic bug. The quota sentence says the count does not
 * move until next month; `retriable` decides whether "Send again" is on the
 * screen at all. One drifting from the other gives a musician either a retry
 * that is guaranteed to be refused, or the news that they are out of analyses
 * with no way on. Selecting both from one read makes them agree by
 * construction, the same reason `timedMeasures` exists on the insights side.
 *
 * A module rather than a branch in the screen, for the reason this directory
 * keeps repeating: there is no React Native testing library here
 * (`DECISIONS.md`, 2026-08-24), so a rule inside a `.tsx` is a rule nothing
 * checks — and the capture-path audit found eight of its nine defects in
 * exactly that layer. Two of the five branches below are driven by
 * `walk-app.mjs` through the built app; the other three are not reachable
 * there at all.
 *
 * Never the underlying error. "NotAllowedError" and "Failed to fetch" tell
 * someone holding a violin nothing they can act on.
 */
export interface TakeFailure {
  /** The sentence on the screen. Always names the next move. */
  message: string;
  /**
   * Whether the take is kept and "Send again" offered.
   *
   * False for the two answers another attempt cannot change: the **quota**,
   * whose count does not move until next month, and a **404**, which means the
   * piece this take belongs to is not there to attach it to. Everything else —
   * a dropped connection, a server that was restarting — is worth one tap, and
   * the WAV is still in hand.
   */
  retriable: boolean;
  /**
   * A remedy the app can carry out itself, or null.
   *
   * Separate from `retriable`, which is about the take: `retriable` asks
   * whether *this* WAV is worth sending again, and this asks whether there is
   * anything to do about the failure other than read it. A refused quota is
   * neither. A document WebKit will not capture from is only the second —
   * there is no take yet.
   *
   * It exists because the screen had no way to tell the difference and so
   * offered nothing: the sentence named a reload and every control that could
   * have performed one was in browser chrome the page cannot reach, or in a
   * scroll gesture the screen does not have.
   */
  recovery: MicrophoneRecovery;
}

/**
 * The generic case. Named so a test can assert *which* branch was taken.
 *
 * **The reassurance leads.** It read "That take couldn't be sent. It is still
 * here — check your connection…", which opens on the failure and puts the one
 * thing a musician is actually afraid of — that the playing is gone — in the
 * second clause, after a sentence that sounds like it might be. The playing is
 * the expensive thing here; a failed upload costs a tap.
 *
 * "On this device" rather than "still here", because it is durable: the take
 * goes into the queue `drainQueue` retries on every foreground, so it survives
 * closing the app. `PIECE_GONE_FAILURE` below is the case where that claim
 * would be false, and it exists because making it there was worse than losing
 * the take.
 */
export const GENERIC_TAKE_FAILURE =
  'Your take is safe. Check your connection and send it again.';

/**
 * The piece is gone, so there is nothing to attach the take to.
 *
 * **Added because retrying this was worse than losing it.** `createAnalysis`
 * answers 404 when the score does not exist or is not yours, and that was read
 * as an ordinary failure — so the take was kept, queued, and retried on every
 * foreground for the life of the install. Worse, a drain pass stops at the
 * first failure by design (the usual cause is the connection, not the take),
 * so one such entry sat at the head of the queue and blocked every real take
 * behind it.
 *
 * The old sentence made two claims that were both false here: *"It is still
 * here"* and *"send it again"*.
 *
 * **The risk this accepts, stated plainly.** A 404 from something that is not
 * the API — a proxy answering during a deploy — would now discard a take that
 * a retry might have sent. That is a worse *single* outcome than a wasted
 * retry, and it is speculative, where the queue-blocking failure above is
 * measured. If it ever shows up, the fix is to key on the API's own body
 * rather than on the status.
 */
export const PIECE_GONE_FAILURE =
  'That piece isn’t in your library any more.';

/** A take that captured nothing at all — every sample zero. */
export const SILENT_TAKE_FAILURE =
  'That take was silent. Check the mic isn’t muted or covered.';

/** The HTTP status an `ApiError` carries, or null for anything else. */
function statusOf(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const { status } = error as { status?: unknown };
    return typeof status === 'number' ? status : null;
  }
  return null;
}

/**
 * @param os `Platform.OS`, passed in so this stays a pure function. The
 * permission recovery differs by platform — a browser has site controls, iOS
 * has Settings — and only the caller knows which it is running on.
 */
export function readTakeFailure(error: unknown, os: string): TakeFailure {
  // The quota is read first and kept, because it is the one answer that
  // changes both fields. Reading it twice is how the two came to be separable.
  const quota = describeTierLimit(error);

  if (error instanceof MicrophonePermissionError) {
    return {
      message: microphonePermissionRecovery(os).message,
      retriable: true,
      // The permission's own recovery is `canOpenSettings`, which is a
      // platform question rather than a page one and is read straight from
      // `microphonePermissionRecovery` by the screen.
      recovery: null,
    };
  }
  if (error instanceof MicrophoneUnavailableError) {
    // `microphoneFailure` already turned the browser's own name for this into
    // a sentence written for a musician; passing it through keeps that work.
    return { message: error.message, retriable: true, recovery: error.recovery };
  }
  if (error instanceof EmptyRecordingError) {
    return { message: SILENT_TAKE_FAILURE, retriable: true, recovery: null };
  }
  if (quota) {
    // **Before the generic message**, which is neither a connection problem
    // nor something trying again will fix.
    return { message: quota, retriable: false, recovery: null };
  }
  // The other answer a second attempt cannot change. After the quota, because
  // the quota is a 403 and this is a 404 — they cannot both match — but before
  // the generic case, for the same reason the quota is.
  //
  // **Read off the shape, not with `instanceof ApiError`**, and that is about
  // keeping this module testable rather than about being clever. `ApiError`
  // lives in `data/api/client`, which reaches `data/auth/session`, which
  // imports `react-native` — whose Flow syntax vitest cannot parse. Importing
  // it here made `takeFailure.test.ts` stop collecting entirely, reporting
  // "no tests" rather than a failure. `ApiError` is the only thing in this app
  // that carries a numeric `status`, and the same structural reading is what
  // `drainQueue` does with `resume`.
  if (statusOf(error) === 404) {
    return { message: PIECE_GONE_FAILURE, retriable: false, recovery: null };
  }
  return { message: GENERIC_TAKE_FAILURE, retriable: true, recovery: null };
}
