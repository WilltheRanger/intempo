import { MicrophonePermissionError, MicrophoneUnavailableError } from './types';

/**
 * Why `getUserMedia` said no, in a sentence that is true.
 *
 * **Every failure that was not a refusal used to become "No microphone is
 * available on this device."** Reported from a real iPhone, on a phone that
 * plainly has one. That sentence is the app blaming the musician's hardware
 * for something it does not know the cause of — the same mistake
 * `_FAILURE_REASONS` was written to stop the transcription pipeline making,
 * and it is worse here, because there is nothing a musician can do about a
 * device they have been told is missing.
 *
 * It is also undiagnosable. One message for six causes means a screenshot of
 * it narrows nothing, which is exactly the position the first report left us
 * in. So the unrecognised case **names the error**: ugly, and the only way the
 * next report is worth more than the first.
 *
 * A rules module rather than a branch inside `audioRecorder.web.ts`, because
 * there is no React Native testing library here and the recorder is driven
 * through a stub graph — see `DECISIONS.md`, 2026-08-24.
 */

/** What a browser calls the failure, and what it actually means. */
const CAUSES: ReadonlyArray<readonly [readonly string[], string]> = [
  [
    // The only case where "no microphone" is the truth.
    ['NotFoundError', 'DevicesNotFoundError'],
    'No microphone is available on this device.',
  ],
  [
    // The device exists and something else is holding it. On a phone that is
    // usually a call, a voice memo, or another tab still recording.
    ['NotReadableError', 'TrackStartError', 'AbortError'],
    'The microphone is busy. Close anything else that is using it — a call, a '
      + 'voice memo, another tab — and try again.',
  ],
  [
    ['SecurityError'],
    'This page is not allowed to use the microphone. Opening it directly, '
      + 'rather than inside another app, usually fixes it.',
  ],
];

/**
 * True when the page is running as a home-screen app rather than in a browser.
 *
 * iOS treats a home-screen web app as its own context, and `getUserMedia`
 * there has a long history of failing where the same page in Safari works. We
 * cannot fix WebKit, but we can stop reporting it as missing hardware and name
 * the one move that is known to help.
 *
 * Both spellings on purpose: `navigator.standalone` is Safari's own and is the
 * one that answers on an iPhone; `display-mode` is the standard.
 */
export function isHomeScreenApp(): boolean {
  const nav = globalThis.navigator as (Navigator & { standalone?: boolean }) | undefined;
  if (nav?.standalone === true) {
    return true;
  }
  try {
    return globalThis.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    // `matchMedia` throws on a malformed query in some engines, and a media
    // query is never worth failing a recording over.
    return false;
  }
}

/** The sentence to add when this build is a home-screen app, or ''. */
export function homeScreenAdvice(standalone: boolean): string {
  return standalone
    ? ' This is the version saved to your home screen; opening intempo in the '
      + 'browser instead usually lets the microphone through.'
    : '';
}

/**
 * Turn a `getUserMedia` rejection into the error the screen should show.
 *
 * `NotAllowedError` is its own type because the musician's next step is
 * different in kind — it is a decision they can revisit, not a fault.
 */
export function microphoneFailure(
  error: unknown,
  standalone: boolean = isHomeScreenApp(),
): MicrophonePermissionError | MicrophoneUnavailableError {
  const name = error instanceof DOMException ? error.name : '';

  // A refusal, or a policy that blocks the prompt. Same next step either way.
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new MicrophonePermissionError();
  }

  for (const [names, message] of CAUSES) {
    if (names.includes(name)) {
      // "No microphone" is the one message the home-screen hint would
      // contradict: if the device really has none, Safari will not find one
      // either. Every other cause here can be a context problem.
      const advice = name.startsWith('NotFound') || name.startsWith('DevicesNotFound')
        ? ''
        : homeScreenAdvice(standalone);
      return new MicrophoneUnavailableError(message + advice);
    }
  }

  // Unrecognised. Say so, and say which — a report of this is the only way the
  // list above grows.
  const named = name ? ` (${name})` : '';
  return new MicrophoneUnavailableError(
    `The microphone could not be started${named}.` + homeScreenAdvice(standalone),
  );
}

/** Whether asking again without our audio preferences is worth a try. */
export function shouldRetryUnconstrained(error: unknown): boolean {
  // We ask for raw, unprocessed mono audio because the analysis wants the
  // attacks as played. That is a preference, and a device that cannot give it
  // should still get to record: a take with echo cancellation on beats no take
  // at all.
  return (
    error instanceof DOMException
    && (error.name === 'OverconstrainedError'
      || error.name === 'ConstraintNotSatisfiedError')
  );
}
