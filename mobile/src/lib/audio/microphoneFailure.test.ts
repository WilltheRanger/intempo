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
      expect(failure.message).toBe('No microphone is available on this device.');
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
    expect(none).toBe('No microphone is available on this device.');

    expect(homeScreenAdvice(false)).toBe('');
  });
});

describe('asking again without our preferences', () => {
  it('retries only when the constraints were the thing refused', () => {
    for (const name of ['OverconstrainedError', 'ConstraintNotSatisfiedError']) {
      expect(shouldRetryUnconstrained(domException(name))).toBe(true);
    }
    for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError']) {
      expect(shouldRetryUnconstrained(domException(name))).toBe(false);
    }
    expect(shouldRetryUnconstrained(new Error('boom'))).toBe(false);
  });
});

describe('a document that cannot capture', () => {
  /*
   * **Reported from a real iPhone on 2026-09-04** — Safari, the deployed
   * build, "The microphone could not be started (InvalidStateError)." That
   * sentence is the table's unrecognised branch working as designed: its
   * comment says naming the error is "the only way the next report is worth
   * more than the first", and this is the next report.
   */
  it('is named, rather than left as a DOM error code', () => {
    const failure = microphoneFailure(
      new DOMException('bad state', 'InvalidStateError'),
      false,
    );

    expect(failure.message).not.toContain('InvalidStateError');
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
