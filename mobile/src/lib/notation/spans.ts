import type { ScoreMeasure, ScoreSlur, ScoreTuplet } from '../../data/types';

/**
 * Keeping slurs and brackets pointing at the notes they were drawn over.
 *
 * `slurs` and `tuplets` address notes **by index**, so inserting or deleting a
 * note silently moves every mark after it onto the wrong notes. The correction
 * screen replaced a measure's notes wholesale — `{...measure, notes}` — and
 * carried the old indices across untouched, so adding one note near the start
 * of a bar shifted every slur in it by one and nothing said so.
 *
 * That has been true since the editor shipped; brackets inherited it the day
 * they were added. The marks are not decoration: `build_timeline` reads slur
 * interiors to decide which notes are *timed at all*, so a slur pointing one
 * note to the left excludes a note the musician attacked and times one they
 * played under the bow.
 *
 * Pure, and separate from the screen, because the interesting part is the
 * arithmetic at the edges — a mark that starts exactly where the note was
 * inserted, one that ends there, one that collapses.
 */

interface Span {
  start_note_index: number;
  end_note_index: number;
}

/**
 * A span after a note is inserted at `at`.
 *
 * A note inserted *inside* a mark extends it. That is what the page would show:
 * a slur drawn over a run covers a note added into the middle of that run, and
 * a bracket over a triplet that gains a fourth note is a bracket over four
 * notes — which is wrong, and is exactly what `tuplet_faults` should then say
 * about it. Reindexing keeps the mark honest; it does not make the edit correct.
 */
function shiftForInsert<T extends Span>(span: T, at: number): T {
  const start = span.start_note_index >= at
    ? span.start_note_index + 1
    : span.start_note_index;
  // `>=` on the end too, so a note inserted at the mark's last index falls
  // under it rather than after it — an insert *at* the end of a slur is inside
  // the phrase, not the start of the next one.
  const end = span.end_note_index >= at ? span.end_note_index + 1 : span.end_note_index;
  return { ...span, start_note_index: start, end_note_index: end };
}

/** A span after the note at `at` is deleted, or null when nothing is left. */
function shiftForDelete<T extends Span>(span: T, at: number): T | null {
  const start = span.start_note_index > at
    ? span.start_note_index - 1
    : span.start_note_index;
  const end = span.end_note_index >= at ? span.end_note_index - 1 : span.end_note_index;
  // The mark covered only the deleted note. There is nothing left to draw it
  // over, and a mark with end before start is not a shrunken mark, it is a
  // broken one.
  if (end < start) {
    return null;
  }
  return { ...span, start_note_index: start, end_note_index: end };
}

export interface MeasureMarks {
  slurs: ScoreSlur[];
  tuplets: ScoreTuplet[];
}

/** Every mark in a measure, moved to follow an inserted note. */
export function marksAfterInsert(marks: MeasureMarks, at: number): MeasureMarks {
  return {
    slurs: marks.slurs.map((slur) => shiftForInsert(slur, at)),
    tuplets: marks.tuplets.map((tuplet) => shiftForInsert(tuplet, at)),
  };
}

/** Every mark in a measure, moved to follow a deleted note. */
export function marksAfterDelete(marks: MeasureMarks, at: number): MeasureMarks {
  return {
    slurs: marks.slurs.map((s) => shiftForDelete(s, at)).filter((s): s is ScoreSlur => s !== null),
    tuplets: marks.tuplets
      .map((t) => shiftForDelete(t, at))
      .filter((t): t is ScoreTuplet => t !== null),
  };
}

/** The marks a measure carries, with the optional field resolved. */
export function marksOf(measure: ScoreMeasure): MeasureMarks {
  return { slurs: measure.slurs ?? [], tuplets: measure.tuplets ?? [] };
}
