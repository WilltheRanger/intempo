import { describeTierLimit } from '../tierLimit';
import { microphonePermissionRecovery } from './permission';
import {
  EmptyRecordingError,
  MicrophonePermissionError,
  MicrophoneUnavailableError,
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
   * False only for the quota: the count does not move until next month, so a
   * retry is the same refusal a second time. Everything else — a dropped
   * connection, a server that was restarting — is worth one tap, and the WAV
   * is still in hand.
   */
  retriable: boolean;
}

/** The generic case. Named so a test can assert *which* branch was taken. */
export const GENERIC_TAKE_FAILURE =
  'That take couldn’t be sent. It is still here — check your connection and send it again.';

/** A take that captured nothing at all — every sample zero. */
export const SILENT_TAKE_FAILURE =
  'That take came back silent. Check the microphone isn’t muted or covered, then try again.';

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
    return { message: microphonePermissionRecovery(os).message, retriable: true };
  }
  if (error instanceof MicrophoneUnavailableError) {
    // `microphoneFailure` already turned the browser's own name for this into
    // a sentence written for a musician; passing it through keeps that work.
    return { message: error.message, retriable: true };
  }
  if (error instanceof EmptyRecordingError) {
    return { message: SILENT_TAKE_FAILURE, retriable: true };
  }
  if (quota) {
    // **Before the generic message**, which is neither a connection problem
    // nor something trying again will fix.
    return { message: quota, retriable: false };
  }
  return { message: GENERIC_TAKE_FAILURE, retriable: true };
}
