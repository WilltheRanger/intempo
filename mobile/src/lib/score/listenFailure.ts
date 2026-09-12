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
 * What a browser called the failure, short enough to sit in a sentence.
 *
 * The name for a `DOMException` or an `Error` subclass, since that is the part
 * that identifies the fault — `RangeError` for an allocation this device
 * cannot make, `NotSupportedError` for a decode it will not do. The message
 * too when there is one, trimmed: a WebKit allocation failure carries text
 * worth seeing, and a 200-character stack fragment is not.
 */
export function causeOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error === 'string' && error.trim() ? error.trim().slice(0, 80) : '';
  }
  const name = error.name && error.name !== 'Error' ? error.name : '';
  const message = error.message?.trim().slice(0, 80) ?? '';
  if (name && message) return `${name}: ${message}`;
  return name || message;
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
