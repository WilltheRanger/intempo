import { causeOf } from '../causeOf';
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
    // **Reported from a real iPhone on 2026-09-04**, in Safari, on the
    // deployed build — the first time this table's "name the error" branch
    // has been paid back, which is exactly what its comment said it was for.
    //
    // WebKit rejects `getUserMedia` with this when the *document* is in a
    // state that cannot capture, rather than when anything is wrong with the
    // microphone or the permission. Tapping again does not clear it, because
    // nothing about the document changes between taps — which makes the
    // default sentence ("could not be started") actively unhelpful: it invites
    // the one move that cannot work.
    //
    // Reloading is what resets a document, and it costs a musician nothing
    // here, because a take that has not started is not a take yet. This
    // comment used to add "it is one tap in Safari's own chrome", which is the
    // assumption that made the advice useless on 2026-09-12: in a home-screen
    // app there is no chrome. `RELOAD_FIXES` below is the app offering it
    // itself rather than describing where to find it.
    ['InvalidStateError'],
    'The page needs reloading before it can record — this is the page\'s '
      + 'state, not your microphone.',
  ],
  [
    ['SecurityError'],
    'This page is not allowed to use the microphone. Opening it directly, '
      + 'rather than inside another app, usually fixes it.',
  ],
];

/**
 * The failures a reload fixes, and the only ones.
 *
 * **Reported from a real iPhone on 2026-09-12, on the deployed build**, in a
 * home-screen web app: the screen said "Pull down to refresh, then try again"
 * and `RecordScreen` renders `<ScreenContainer scrollable={false}>`. There is
 * no scroll view on it to pull. The advice named a gesture the screen does not
 * have — the defect `cameraFallback.ts` was written about, in the one place
 * that had already been fixed once for saying the wrong thing.
 *
 * It was worse than useless in exactly the context it was shown: a standalone
 * home-screen app has no address bar either, so both ways a person would
 * normally reload a page were absent while the sentence told them to reload it.
 *
 * `location.reload()` is the remedy that was always available and never
 * offered. WebKit rejects `getUserMedia` with `InvalidStateError` when the
 * document is not fully active — a document restored from the page cache after
 * the app was backgrounded — and a fresh document is precisely what a reload
 * produces. Tapping Record again cannot work, because nothing about the
 * document changes between taps.
 *
 * Kept as a list rather than folded into `CAUSES` because it answers a
 * different question: `CAUSES` says what happened, this says what the app can
 * do about it, and only one cause so far has an answer the app can act on.
 */
const RELOAD_FIXES: readonly string[] = ['InvalidStateError'];

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
/**
 * The browser's own words, parenthesised, or '' when it said nothing.
 *
 * **Every branch carries this now, not only the unrecognised one**, and that
 * is the whole lesson of 2026-09-12–13. The table matched `InvalidStateError`
 * and printed a confident, human sentence about the document needing a reload
 * — while WebKit was saying, in the message this code discarded:
 *
 *     AudioSession category is not compatible with audio capture.
 *
 * Five fixes were built on the obvious reading of the *name*. The *message*
 * named the cause from the first screenshot. A recognised error is exactly
 * where this is most dangerous, because a matched row reads as a diagnosis.
 */
function said(error: unknown): string {
  const cause = causeOf(error);
  return cause ? ` (${cause})` : '';
}

export function microphoneFailure(
  error: unknown,
  standalone: boolean = isHomeScreenApp(),
): MicrophonePermissionError | MicrophoneUnavailableError {
  const name = error instanceof DOMException ? error.name : '';

  // A refusal, or a policy that blocks the prompt. Same next step either way.
  // The one case with no cause appended: the musician made a decision, there
  // is no fault to name, and `MicrophonePermissionError` carries its own
  // route into the site controls.
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
      return new MicrophoneUnavailableError(
        message + advice + said(error),
        RELOAD_FIXES.includes(name) ? 'reload' : null,
      );
    }
  }

  // Unrecognised. Say so, and say which — a report of this is the only way the
  // list above grows.
  return new MicrophoneUnavailableError(
    `The microphone could not be started.${said(error)}`.trim()
      + homeScreenAdvice(standalone),
  );
}

/**
 * The two answers a second attempt cannot change.
 *
 * A refusal is a decision, and asking again with different constraints asks
 * the same question. No device is no device, and dropping a preference will
 * not conjure one.
 */
const FINAL = [
  'NotAllowedError',
  'PermissionDeniedError',
  'NotFoundError',
  'DevicesNotFoundError',
];

/**
 * Whether asking again without our audio preferences is worth a try.
 *
 * We ask for raw, unprocessed mono audio because the analysis wants the
 * attacks as played. **That is a preference, not a requirement** — and the
 * rule has always said so: "a device that cannot give it should still get to
 * record: a take with echo cancellation on beats no take at all."
 *
 * **The rule was right and its trigger was far too narrow**, which is the
 * defect three fixes to `audioRecorder.web.ts` walked past. It retried only on
 * `OverconstrainedError` and `ConstraintNotSatisfiedError`, which is what a
 * browser is *supposed* to answer when it cannot meet a constraint. WebKit,
 * reported from a real iPhone across 2026-09-12, answers `InvalidStateError`
 * instead — so the fallback that exists precisely for this never ran, and the
 * take died on a preference.
 *
 * The evidence it took to get here is worth keeping, because every earlier
 * reading of it was wrong:
 *
 *   - the stock WebRTC `getUserMedia` sample, which asks for plain
 *     `{ audio: true }`, **records on that same phone**;
 *   - ours, asking for four constraints, does not — in Safari and in the
 *     home-screen app alike;
 *   - it works in Chromium, which satisfies them;
 *   - and it is unmoved by three fixes to the `AudioContext` around it,
 *     because the context was never what WebKit was objecting to.
 *
 * So the question this asks is inverted: not "is this the one error that means
 * constraints", but "is there any reason a second, plainer attempt could not
 * help". Two answers qualify, and both are in `FINAL`. Everything else is
 * worth one more call — the cost of being wrong is a single extra
 * `getUserMedia` on a path that was about to fail anyway.
 */
export function shouldRetryUnconstrained(error: unknown): boolean {
  const name = error instanceof DOMException ? error.name : '';
  return !FINAL.includes(name);
}
