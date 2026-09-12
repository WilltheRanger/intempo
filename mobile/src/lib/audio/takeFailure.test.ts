import { describe, expect, it, vi } from 'vitest';

import { microphonePermissionRecovery } from './permission';
import {
  GENERIC_TAKE_FAILURE,
  PIECE_GONE_FAILURE,
  SILENT_TAKE_FAILURE,
  readTakeFailure,
} from './takeFailure';
import {
  EmptyRecordingError,
  MicrophonePermissionError,
  MicrophoneUnavailableError,
} from './types';

/**
 * The last thing between a failed take and the musician holding the violin.
 *
 * Two of these five branches are driven by `walk-app.mjs` through the built
 * app — a refused microphone and a silent take. The other three are not
 * reachable there at all: there is no quota to exhaust in a fixtures build and
 * no way to make the server fail. So they were, until now, three sentences and
 * one retry decision that nothing had ever evaluated.
 *
 * The pairing is the point. `message` and `retriable` were separate rules
 * thirty lines apart in `RecordScreen.tsx`, both reading
 * `describeTierLimit(error)`, and either could have been edited alone.
 */

/**
 * `describeTierLimit` reaches `react-native` transitively.
 *
 * `lib/tierLimit.ts` imports `ApiError` from `data/api/client`, which imports
 * `data/auth/session`, which imports `react-native` — whose Flow syntax vitest
 * cannot parse. That is why `tierLimit.test.ts` covers `analysisAllowance` and
 * not `describeTierLimit`, and it is a **standing gap**, not something this
 * file introduces: the function that recognises a quota refusal off the wire
 * is untestable in this setup.
 *
 * What is testable here is the part `takeFailure` owns — the ordering, and
 * that the sentence and the retry decision come from one read. So the quota
 * reader is stubbed to a known answer and the branch is exercised through it.
 */
const QUOTA_SENTENCE =
  'You have used all three analyses this month. The count resets on 1 October.';

vi.mock('../tierLimit', () => ({
  describeTierLimit: (error: unknown) =>
    error instanceof Error && error.message === 'quota' ? QUOTA_SENTENCE : null,
}));

/** An error the stubbed reader recognises as a quota refusal. */
function quotaError(): unknown {
  return new Error('quota');
}

describe('what the musician is told', () => {
  it('names the way back in when the microphone was refused', () => {
    const failure = readTakeFailure(new MicrophonePermissionError(), 'web');

    expect(failure.message).toBe(microphonePermissionRecovery('web').message);
  });

  it('says it by platform, because the way back in differs', () => {
    // A browser has site controls; iOS has Settings. Passing `Platform.OS`
    // rather than reading it keeps this a pure function — and this is the
    // assertion that the parameter is actually used.
    expect(readTakeFailure(new MicrophonePermissionError(), 'ios').message).not.toBe(
      readTakeFailure(new MicrophonePermissionError(), 'web').message,
    );
  });

  it('passes through the sentence a diagnosed device failure already carries', () => {
    // `microphoneFailure` turned the browser's own name for this into words
    // written for a musician. Substituting a sentence here would throw that
    // away and put "No microphone is available on this device" back in front
    // of somebody holding a phone that plainly has one.
    const diagnosed = new MicrophoneUnavailableError(
      'The microphone is busy. Close anything else that is using it.',
    );

    expect(readTakeFailure(diagnosed, 'web').message).toBe(diagnosed.message);
  });

  it('tells a silent take to check the microphone, not the connection', () => {
    expect(readTakeFailure(new EmptyRecordingError(), 'ios').message).toBe(
      SILENT_TAKE_FAILURE,
    );
  });

  it('names the quota rather than blaming the connection', () => {
    // **Ordering.** The quota check sits before the generic message because it
    // is neither a connection problem nor something trying again will fix.
    // Reversed, a musician out of analyses is told to check their connection
    // and send it again — advice that measurably cannot work, which is the
    // same defect `_FAILURE_REASONS` exists to stop on the server side.
    const message = readTakeFailure(quotaError(), 'ios').message;

    expect(message).toBe(QUOTA_SENTENCE);
    expect(message).not.toBe(GENERIC_TAKE_FAILURE);
    expect(message.toLowerCase()).not.toContain('connection');
  });

  it('falls back to the generic sentence, which keeps the take', () => {
    expect(readTakeFailure(new Error('Failed to fetch'), 'web').message).toBe(
      GENERIC_TAKE_FAILURE,
    );
  });

  it('never shows the underlying error', () => {
    // "NotAllowedError" and "Failed to fetch" tell someone holding a violin
    // nothing they can act on.
    for (const raw of ['NotAllowedError', 'TypeError: Failed to fetch', 'ECONNRESET']) {
      expect(readTakeFailure(new Error(raw), 'web').message).not.toContain(raw);
    }
  });
});

describe('whether another go is offered', () => {
  it('is refused only for the quota', () => {
    // The count does not move until next month, so "Send again" is the same
    // refusal a second time.
    expect(readTakeFailure(quotaError(), 'ios').retriable).toBe(false);
  });

  it('is offered for everything else, because the WAV is still in hand', () => {
    for (const error of [
      new MicrophonePermissionError(),
      new MicrophoneUnavailableError(),
      new EmptyRecordingError(),
      new Error('Failed to fetch'),
    ]) {
      expect(readTakeFailure(error, 'web').retriable, String(error)).toBe(true);
    }
  });

  it('agrees with the sentence it comes with', () => {
    // **The reason this is one function.** The quota sentence tells a musician
    // the count does not move until next month; `retriable` decides whether
    // "Send again" is on the screen. Drifting apart gives them either a retry
    // that is guaranteed to be refused, or the news that they are out of
    // analyses with no way on.
    const quota = readTakeFailure(quotaError(), 'ios');
    const generic = readTakeFailure(new Error('boom'), 'ios');

    expect(quota.retriable).toBe(false);
    expect(quota.message).not.toBe(generic.message);
    expect(generic.retriable).toBe(true);
  });
});


/**
 * The piece is gone.
 *
 * `createAnalysis` answers 404 when the score does not exist or is not yours.
 * That used to read as an ordinary failure, so the take was kept, queued, and
 * retried on every foreground for the life of the install — and because a
 * drain pass stops at the first failure by design, one such entry sat at the
 * head of the queue and blocked every real take behind it.
 */
describe('a take whose piece is not there', () => {
  /** What `apiFetch` throws: anything carrying a numeric `status`. */
  const answered = (status: number) =>
    Object.assign(new Error(`Request failed (${status})`), { status });

  it('is not offered another go, because there is nothing to send it to', () => {
    expect(readTakeFailure(answered(404), 'web').retriable).toBe(false);
  });

  it('says what happened instead of promising the take is still here', () => {
    // The old sentence made two claims that were both false: "It is still
    // here" and "send it again".
    const failure = readTakeFailure(answered(404), 'web');
    expect(failure.message).toBe(PIECE_GONE_FAILURE);
    expect(failure.message).not.toMatch(/still here|send it again/i);
  });

  it('leaves every other status alone', () => {
    // The narrowness is the point. A 500 or a 503 is a bad moment, the take is
    // real and in hand, and dropping it would be discarding a performance over
    // a server restart.
    for (const status of [400, 401, 403, 409, 429, 500, 502, 503]) {
      const failure = readTakeFailure(answered(status), 'web');
      expect(failure.retriable).toBe(true);
      expect(failure.message).toBe(GENERIC_TAKE_FAILURE);
    }
  });

  it('is not fooled by a plain error that has no status', () => {
    expect(readTakeFailure(new TypeError('Failed to fetch'), 'web')).toEqual({
      message: GENERIC_TAKE_FAILURE,
      retriable: true,
      recovery: null,
    });
  });

  it('will not read a status that is not a number', () => {
    // `ApiError.status` is typed `number` and is the only thing in this app
    // that carries one, so this is the guard rather than a live case — and it
    // is here because coercing instead (`Number(status)`) passed every other
    // test in this file. Discarding a musician's take on a *coincidence* of
    // shape is the outcome worth spending four lines to rule out.
    for (const status of ['404', true, {}, []]) {
      const failure = readTakeFailure(Object.assign(new Error('odd'), { status }), 'web');
      expect(failure.retriable).toBe(true);
      expect(failure.message).toBe(GENERIC_TAKE_FAILURE);
    }
  });
});
