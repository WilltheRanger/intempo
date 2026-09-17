/**
 * Why Listen could not play, in a sentence a musician can act on — and, when
 * there is nothing to act on, in one a bug report can.
 *
 * **Reported from a real iPhone on 2026-09-12: Listen fails always, on the
 * deployed build, while playing correctly in Chromium on a desktop.** Three
 * stages can fail and each had one fixed sentence, so the screenshot narrowed
 * it to "one of three" and two rounds of asking narrowed it to "one of two".
 * That is the position `microphoneFailure` was written about:
 *
 *   > One message for six causes means a screenshot of it narrows nothing,
 *   > which is exactly the position the first report left us in. So the
 *   > unrecognised case **names the error**: ugly, and the only way the next
 *   > report is worth more than the first.
 *
 * Same answer here. The advice comes first because it is what a musician
 * needs; the cause is appended because it is what the next report needs.
 *
 * A module rather than a branch inside `sampledPlayback.ts`, because there is
 * no React Native testing library here (`DECISIONS.md`, 2026-08-24) and a rule
 * inside the playback closure is a rule nothing checks.
 */

import { causeOf } from '../causeOf';

/** Where playback got to before it failed. */
export type ListenStage = 'loading' | 'rendering' | 'starting';

/**
 * Messages that are already about the passage rather than about a fault.
 *
 * These two are thrown deliberately by `renderSoundfont` and say what to do,
 * so they are passed through whole and get no cause appended — naming a
 * `RangeError` after "choose a shorter passage" would be noise on advice that
 * is already complete.
 */
const DELIBERATE = ['ten minutes', 'no playable'];

const ADVICE: Record<ListenStage, string> = {
  loading:
    'Couldn’t load the instrument sound. Check your connection and tap Listen to retry.',
  rendering:
    'Couldn’t prepare the audio. Try a shorter passage and tap Listen to retry.',
  starting: 'Audio couldn’t start. Tap Listen to retry.',
};

/**
 * The `starting` failure that is a **timeout rather than a throw**.
 *
 * **Why this is a function here and not a string at the call site.** The three
 * places playback can fail to begin — the sampled voice, the synthesised one,
 * and the native player — each had their own answer, and all three were wrong
 * in the way this module was written to prevent. Two carried a hand-typed
 * sentence that `listenFailure` never saw, so no cause was ever appended; the
 * third reported **nothing at all** and simply put the button back. A real
 * iPhone report on 2026-09-16 was one of the first kind, and it narrowed the
 * cause to exactly nothing, which is the outcome the header of this file
 * predicts in as many words.
 *
 * Nothing threw, so there is no browser message to keep. What there is
 * instead is the **clock's own excuse**: an `AudioContext` that never advanced
 * is in some state, and which state it is in separates causes that look
 * identical on a screen. `suspended` is a resume being refused; `interrupted`
 * is iOS taking the session away, which is a different bug with a different
 * fix; `running` while `currentTime` stands still is neither, and would mean
 * the clock rather than the session. Naming it costs one word and is the
 * difference between the next report being worth something and being worth
 * what this one was.
 */
export function startTimeout(state: string | undefined, waitedMs: number): Error {
  const timeout = new Error(
    `context ${state ?? 'unknown'} after ${Math.max(0, Math.round(waitedMs))}ms`,
  );
  // `causeOf` keeps both halves, and the name is the half that says this was a
  // clock that never moved rather than something the engine objected to.
  timeout.name = 'AudioStartTimeout';
  return timeout;
}

/**
 * The sentence to show when Listen fails.
 *
 * @param stage how far it got — the three stages fail for different reasons
 * and a musician's next move differs by stage, which is why this is not one
 * message with a cause bolted on.
 */
export function listenFailure(stage: ListenStage, error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (DELIBERATE.some((phrase) => message.includes(phrase))) {
    return message;
  }
  const cause = causeOf(error);
  // Parenthesised and last, so the advice reads first and the diagnosis is
  // there for a screenshot. Without a cause the sentence is what it always
  // was, which is what a browser that reports nothing useful deserves.
  return cause ? `${ADVICE[stage]} (${cause})` : ADVICE[stage];
}
