import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  homeScreenAdvice,
  isHomeScreenApp,
  microphoneFailure,
  shouldRetryUnconstrained,
} from './microphoneFailure';
import { MicrophonePermissionError, MicrophoneUnavailableError } from './types';

/**
 * Reported from a real iPhone: a phone that plainly has a microphone, told
 * **"No microphone is available on this device."** Every `getUserMedia`
 * rejection that was not `NotAllowedError` produced that one sentence.
 *
 * Two separate faults in it. It is *false* — the app blaming the musician's
 * hardware for something it does not know the cause of, which is the mistake
 * `_FAILURE_REASONS` exists to stop the transcription pipeline making. And it
 * is *undiagnosable* — one message for six causes means a screenshot narrows
 * nothing, which is exactly the position the first report left me in.
 */

function domException(name: string): DOMException {
  return new DOMException('stubbed', name);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the app says when the microphone will not start', () => {
  it('claims no microphone only when the browser actually found none', () => {
    for (const name of ['NotFoundError', 'DevicesNotFoundError']) {
      const failure = microphoneFailure(domException(name), false);
      expect(failure).toBeInstanceOf(MicrophoneUnavailableError);
      // `startsWith`, not equality: every sentence now carries the browser's
      // own words after it (see `causeOf`). What this test is about is which
      // errors earn *this* sentence, and that is unchanged.
      expect(failure.message.startsWith('No microphone is available on this device.')).toBe(true);
    }
  });

  it('says the microphone is busy rather than missing when something holds it', () => {
    // On a phone this is a call, a voice memo, or another tab still recording
    // — every one of which the musician can act on, and none of which is
    // "your device has no microphone".
    for (const name of ['NotReadableError', 'TrackStartError', 'AbortError']) {
      const message = microphoneFailure(domException(name), false).message;
      expect(message).toContain('busy');
      expect(message).not.toContain('No microphone is available');
    }
  });

  it('treats a refusal as its own kind of problem, not a fault', () => {
    // A decision the musician can revisit. `RecordScreen` shows the per-platform
    // recovery steps for this one and nothing else.
    for (const name of ['NotAllowedError', 'PermissionDeniedError']) {
      expect(microphoneFailure(domException(name), false)).toBeInstanceOf(
        MicrophonePermissionError,
      );
    }
  });

  it('names an error it does not recognise instead of guessing', () => {
    // Ugly on purpose. A message that covers every cause is a message a
    // screenshot of cannot narrow, which is how the first report of this bug
    // arrived with nothing in it to act on.
    const message = microphoneFailure(domException('SomeNewWebKitError'), false).message;
    expect(message).toContain('SomeNewWebKitError');
    expect(message).not.toContain('No microphone is available');
  });

  it('says nothing false when what was thrown is not a DOMException at all', () => {
    const message = microphoneFailure(new TypeError('undefined is not an object'), false)
      .message;
    expect(message).toContain('could not be started');
    expect(message).not.toContain('No microphone is available');
  });
});

describe('the home-screen app', () => {
  it('is detected by Safari’s own flag and by the standard media query', () => {
    vi.stubGlobal('navigator', { standalone: true });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(isHomeScreenApp()).toBe(true);

    vi.stubGlobal('navigator', {});
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === '(display-mode: standalone)',
    }));
    expect(isHomeScreenApp()).toBe(true);

    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(isHomeScreenApp()).toBe(false);
  });

  it('survives a browser with no matchMedia, because a media query is not worth a take', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('matchMedia', undefined);
    expect(isHomeScreenApp()).toBe(false);
  });

  it('adds the one move that is known to help, and only where it could', () => {
    // iOS treats a home-screen web app as its own context and getUserMedia
    // there has a long history of failing where the same page in Safari works.
    const busy = microphoneFailure(domException('NotReadableError'), true).message;
    expect(busy).toContain('home screen');

    // …but never onto "no microphone". If the device really has none, Safari
    // will not find one either, and sending someone to try is a wasted trip.
    const none = microphoneFailure(domException('NotFoundError'), true).message;
    expect(none).toContain('No microphone is available on this device.');
    expect(none).not.toContain('home screen');

    expect(homeScreenAdvice(false)).toBe('');
  });
});

describe('asking again without our preferences', () => {
  /*
   * **This test encoded the bug, and that is why it passed for months.**
   *
   * It asserted that only `OverconstrainedError` and
   * `ConstraintNotSatisfiedError` earn a retry — which is what a browser is
   * *supposed* to answer when it cannot meet a constraint, and is exactly the
   * assumption the code made. WebKit answers `InvalidStateError` instead, so
   * the fallback that exists for this never ran on the one engine that needed
   * it, and the test agreed with the code all the way down.
   *
   * Reported from a real iPhone across 2026-09-12: the stock WebRTC sample,
   * which asks for plain `{ audio: true }`, records on that phone; ours, with
   * four constraints, does not. Three fixes to the surrounding `AudioContext`
   * changed nothing, because the context was never what was being refused.
   */
  it('retries for anything a plainer request might survive', () => {
    for (const name of [
      'OverconstrainedError',
      'ConstraintNotSatisfiedError',
      // The one that took three wrong fixes to find.
      'InvalidStateError',
      'NotReadableError',
      'AbortError',
      'SecurityError',
      'SomeErrorWebKitHasNotInventedYet',
    ]) {
      expect(shouldRetryUnconstrained(domException(name)), name).toBe(true);
    }
  });

  it('does not retry the two answers a second attempt cannot change', () => {
    // A refusal is a decision, and asking again asks the same question. No
    // device is no device, and dropping a preference will not conjure one.
    for (const name of [
      'NotAllowedError',
      'PermissionDeniedError',
      'NotFoundError',
      'DevicesNotFoundError',
    ]) {
      expect(shouldRetryUnconstrained(domException(name)), name).toBe(false);
    }
  });

  it('retries something that is not a DOMException at all', () => {
    // A browser that rejects with a plain Error tells us nothing about why,
    // and one more call is cheap on a path that has already failed.
    expect(shouldRetryUnconstrained(new Error('boom'))).toBe(true);
  });
});

describe('a document that cannot capture', () => {
  /*
   * **This assertion was reversed on 2026-09-13, and the reason is the whole
   * point of the change.**
   *
   * It demanded that a *recognised* error never show its DOM name: the table
   * had a human sentence for `InvalidStateError`, so the code was considered
   * an implementation detail. That was right about the sentence and wrong
   * about the cause, and it cost five fixes.
   *
   * WebKit's message for this error is "AudioSession category is not
   * compatible with audio capture." — which names the real fault outright.
   * The app kept `error.name`, threw `error.message` away, and printed a
   * confident sentence about the document needing a reload. Four fixes were
   * built on that reading; the answer was in the string being discarded.
   *
   * A matched row is exactly where this is most dangerous, because it reads
   * as a diagnosis. So the cause travels with every branch now, and this test
   * holds it there.
   */
  it('carries what the browser actually said, even when the table knows the error', () => {
    const failure = microphoneFailure(
      new DOMException(
        'AudioSession category is not compatible with audio capture.',
        'InvalidStateError',
      ),
      false,
    );

    // The advice a musician can act on comes first and is unchanged.
    expect(failure.message.startsWith('The page needs reloading')).toBe(true);
    // The engine's own words come last, in parentheses, for the next report.
    expect(failure.message).toContain('InvalidStateError');
    expect(failure.message).toContain('AudioSession category is not compatible');
  });

  it('asks for the one thing that can clear it', () => {
    // WebKit rejects `getUserMedia` this way when the *document* cannot
    // capture, not when anything is wrong with the microphone. Tapping again
    // changes nothing about the document, so advice to try again is advice
    // that measurably cannot work — the same defect `_FAILURE_REASONS` exists
    // to stop on the transcription side.
    const failure = microphoneFailure(
      new DOMException('bad state', 'InvalidStateError'),
      false,
    );

    expect(failure.message).toMatch(/reload|refresh/i);
  });

  it('does not blame the microphone', () => {
    const failure = microphoneFailure(
      new DOMException('bad state', 'InvalidStateError'),
      false,
    );

    expect(failure.message).not.toMatch(/no microphone|is busy/i);
  });

  /*
   * **Reported from a real iPhone on 2026-09-12** — the deployed build, in a
   * home-screen web app. The sentence was right and the advice was not: it
   * said "Pull down to refresh, then try again" on a screen that renders
   * `<ScreenContainer scrollable={false}>`, with no address bar behind it
   * either. Every route it named was absent.
   *
   * So the failure now carries the remedy instead of describing where to find
   * one, and the screen draws a control for it. These two cases are what stop
   * the sentence and the button drifting apart again.
   */
  it('carries a reload the app can perform itself', () => {
    const failure = microphoneFailure(
      new DOMException('bad state', 'InvalidStateError'),
      false,
    );

    expect(failure).toBeInstanceOf(MicrophoneUnavailableError);
    expect((failure as MicrophoneUnavailableError).recovery).toBe('reload');
  });

  it('names no gesture the screen does not have', () => {
    const failure = microphoneFailure(
      new DOMException('bad state', 'InvalidStateError'),
      true,
    );

    // Pulling down, swiping and the address bar are all things this screen or
    // this context does not have. The button is the instruction now.
    expect(failure.message).not.toMatch(/pull down|swipe|address bar/i);
  });

  it('offers no reload for a failure a reload cannot fix', () => {
    for (const name of [
      'NotFoundError',
      'NotReadableError',
      'SecurityError',
      'WhateverElseError',
    ]) {
      const failure = microphoneFailure(new DOMException('no', name), false);

      expect(
        (failure as MicrophoneUnavailableError).recovery,
        name,
      ).toBeNull();
    }
  });

  it('is not a permission problem, so the screen must not offer settings', () => {
    // `MicrophonePermissionError` is what turns the screen into "open your
    // settings". Sending somebody to a permission they have already granted
    // is a dead end.
    const failure = microphoneFailure(
      new DOMException('bad state', 'InvalidStateError'),
      false,
    );

    expect(failure).toBeInstanceOf(MicrophoneUnavailableError);
  });
});
