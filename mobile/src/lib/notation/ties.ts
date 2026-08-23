import type { ScoreMeasure, ScoreNote } from '../../data/types';

/**
 * Which ties are real, read the way the backend reads them.
 *
 * A mirror of `score_schema.read_ties`. The two have to agree, because one
 * decides what the app *plays* when you press Listen and the other decides what
 * the verdict is measured against — and a musician told they rushed a bar that
 * sounded right in the app has been given two different pieces of music.
 *
 * They did not agree. `scheduleScore` absorbed a tie on `tied_to_next` alone,
 * with two consequences:
 *
 *  - **No pitch check.** A tie joins one pitch to itself; a curve between two
 *    different pitches is a slur, and the app merged it into one long note
 *    while the backend counts two. Same mark on the page, and the pair a vision
 *    model most often confuses.
 *  - **Stopped at the barline.** The loop only looked as far as the end of the
 *    measure, so a tie into the next bar was never absorbed — and a tie across
 *    a barline is the commonest kind there is. The app re-attacked a note the
 *    analysis expects to be held straight through.
 *
 * Walked flat across the whole score for that second reason.
 */

export interface TieReading {
  /** Absorbed into the previous note's sound: a real tie, no new attack. */
  absorbed: boolean[];
  /** A tie was written into this note and could not be honoured. */
  broken: boolean[];
}

/** Every note in the score, in playing order, ignoring bar lines. */
export function flattenNotes(measures: ScoreMeasure[]): ScoreNote[] {
  return measures.flatMap((measure) => measure.notes ?? []);
}

export function readTies(measures: ScoreMeasure[]): TieReading {
  const flat = flattenNotes(measures);
  const absorbed = flat.map(() => false);
  const broken = flat.map(() => false);

  flat.forEach((note, index) => {
    // A rest ends any tie: `tied_to_next` on a rest is meaningless, and so is
    // a tie into one.
    if (!note.tied_to_next || note.pitch === 'rest') {
      return;
    }
    const next = index + 1 < flat.length ? flat[index + 1] : null;
    if (next === null) {
      return; // nothing to hold; `broken_ties` on the backend reports it
    }
    if (next.pitch === note.pitch) {
      absorbed[index + 1] = true;
    } else {
      broken[index + 1] = true;
    }
  });

  return { absorbed, broken };
}
