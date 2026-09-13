/**
 * What a browser called a failure, short enough to sit inside a sentence.
 *
 * **The rule this project keeps relearning: keep the browser's own words.**
 * `microphoneFailure` read only `error.name` and threw `error.message` away,
 * and that one discarded string cost five wrong fixes across 2026-09-12–13.
 * WebKit had been answering
 *
 *     InvalidStateError: AudioSession category is not compatible with audio
 *     capture.
 *
 * since the very first screenshot — the second half of which names the cause
 * outright, while the first half has an obvious and *wrong* reading ("the
 * document is not fully active") that four fixes were built on.
 *
 * `listenFailure` learned the same thing a day earlier and grew this helper;
 * it lived there, private to the score player, while the microphone path a
 * directory away was making the identical mistake. It is shared now because
 * the rule is not about score playback or about microphones.
 *
 * **Both halves, and both trimmed.** The name identifies the fault class
 * (`RangeError` for an allocation a device cannot make, `NotAllowedError` for
 * a refusal); the message is where an engine says what it actually objected
 * to. Eighty characters because a sentence a musician reads has to stay a
 * sentence, and a stack fragment is not worth seeing.
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
