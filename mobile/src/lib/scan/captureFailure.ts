/**
 * What the scanner says when the shutter itself fails.
 *
 * **A failure state given the same care as a success state.** This was one line
 * of 13pt grey under the viewfinder — *"That photo could not be taken."* — with
 * no explanation and no way on. The musician is standing at a stand with the
 * music open, the thing they just pressed did nothing, and the screen offers
 * them the same button that has just failed.
 *
 * Three things a dead end owes them, and the frame this comes from names all
 * three: what happened, why it is usually harmless, and a way round that does
 * **not** depend on the thing that just failed. The camera app needs no
 * `getUserMedia` grant and no stream from this page, so it is a genuinely
 * different route rather than the same one with a different label.
 *
 * **No em dashes in this copy**, asked for directly. The rest of the app writes
 * with them; a test below holds this screen to it, because a rule that lives
 * only in somebody's memory of a conversation is a rule that comes back.
 */

export interface CaptureFailure {
  /** What happened, in the musician's terms. */
  headline: string;
  /** Why, and why it is usually nothing. */
  body: string;
  /** What to do if it is not nothing. */
  hint: string;
  /** The way back to the thing that failed, which usually works second time. */
  retakeLabel: string;
  /** The way round it, which does not use the camera this page was refused. */
  cameraAppLabel: string;
}

export function captureFailure(): CaptureFailure {
  return {
    headline: 'Couldn’t take that photo',
    // **Not "an error occurred".** The camera returning nothing is the ordinary
    // shape of this failure on both platforms, and saying so is what makes the
    // second clause believable rather than reassurance with nothing behind it.
    //
    // Two clauses and no more. At four lines centred under a one-line heading
    // it outweighed the heading, which is the hierarchy §3 law 4 rules out;
    // the cause and the workaround moved down to the hint, where they are
    // 13pt and clearly a footnote.
    body: 'The camera gave nothing back. Try again.',
    hint: 'Still failing? Use the camera app.',
    retakeLabel: 'Try again',
    cameraAppLabel: 'Open the camera app',
  };
}
