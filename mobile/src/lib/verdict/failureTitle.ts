import type { ResultStatus, TakeFailure } from '../../data/types';

/**
 * The heading over a take that produced no verdict.
 *
 * **Four outcomes shared two headings, and one of them covered three.**
 * "Nothing to measure" stood over a take that was completely silent, a take
 * the pipeline could not line up against the page, and a take of a piece that
 * turned out to be something else — three findings with three different next
 * moves, under one sentence that names none of them. The explanation
 * underneath is the pipeline's own and does distinguish them; a musician who
 * reads the heading and stops is told nothing.
 *
 * **The heading is where the finding goes.** It is the one thing on a centred
 * empty state set in the display face, so it is what is read first and
 * sometimes only (§3 law 4). What was in it — a description of the app's
 * process, "this take didn't get analysed" — is the least useful true thing
 * available.
 *
 * `ResultStatus` is a closed union, so this is a total map rather than a chain
 * of `if`s: a fifth status added to the pipeline fails the typecheck here
 * rather than falling through to whichever branch happened to be last.
 */

const FOR_STATUS: Record<Exclude<ResultStatus, 'ok'>, string> = {
  // **"Nothing", not "too quiet".** `diagnostics.py` is careful about this
  // distinction and so is the sentence under it: no sound reached the
  // microphone at all, which is a routing fault rather than a performance
  // played softly. A musician who played loudly needs to know that.
  no_onsets: 'Nothing reached the microphone',
  // True of all three shapes the pipeline reports here — slurs that were not
  // played as written, bars missing from the transcription, and attacks it
  // could not hear — and it points at the pair of things that explain them,
  // which is what the sentence beneath goes on to name.
  alignment_failed: 'This didn’t line up with the page',
};

/**
 * The heading for a run that failed rather than finishing with nothing usable.
 *
 * The recoverable one owns it. "This take didn't get analysed" is what
 * happened and says nothing about whose fault it was, and the first thing a
 * musician wants to know is whether their playing was the problem.
 */
export function failureTitle(failure: TakeFailure): string {
  return failure.recoverable
    ? 'Something went wrong on our end'
    : 'This recording couldn’t be processed';
}

/** The heading for a run that finished and found nothing it could use. */
export function nothingUsableTitle(status: Exclude<ResultStatus, 'ok'>): string {
  return FOR_STATUS[status];
}
