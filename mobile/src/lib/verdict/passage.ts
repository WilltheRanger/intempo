/**
 * Which part of the page a take covered, as the verdict states it.
 *
 * **Practising a passage is the ordinary case, and the screen said a count.**
 * The pipeline has matched a take against the passage it covers since
 * `align_dtw` learned subsequence matching — a musician who records bars 9 to
 * 12 of a 24-bar part gets a measured verdict rather than "check you're on the
 * right piece", and `test_fragment_alignment.py` pins it. The screen then
 * reported "4 measures", which is true and answers a question nobody asked:
 * four measures *of what*, and why does the list below start at bar 9?
 *
 * So a take that starts partway into the page names its bars. One that starts
 * at the beginning keeps the count, because "Bars 1 to 13" on a complete
 * performance is a range with nothing to contrast against and reads as a
 * caveat where there is none.
 *
 * **It never claims to know the page's length.** `TakeResult` carries the
 * measures that were analysed and no total, so "bars 9 to 12 of 24" is a
 * sentence this cannot write — and guessing the total from the take is how a
 * passage would come to be reported as a whole piece.
 */

export function passageLabel(measures: { measure: number }[]): string | null {
  if (measures.length === 0) {
    return null;
  }
  const first = measures[0].measure;
  const last = measures[measures.length - 1].measure;

  // A take that opens the page. The count is what a musician expects there,
  // and it is what this screen has always said.
  if (first <= 1) {
    return measures.length === 1 ? '1 measure' : `${measures.length} measures`;
  }

  // One bar is not a range, and "Bars 9 to 9" reads as a fault in the sentence
  // rather than as a short take.
  return first === last ? `Bar ${first}` : `Bars ${first} to ${last}`;
}
