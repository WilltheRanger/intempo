import type { Clef, ScoreJson } from '../../data/types';
import { CLEF_LABELS } from '../../lib/notation/clefLabels';

export interface ClefChoice {
  value: Clef;
  label: string;
}

/** The four, in the order a string player meets them. */
export const CLEF_CHOICES: ClefChoice[] = (
  ['treble', 'alto', 'tenor', 'bass'] as const
).map((value) => ({ value, label: CLEF_LABELS[value] }));

/** A saved clef, rendered for a musician. */
export function describeClef(value: Clef | null | undefined): string {
  return value ? CLEF_LABELS[value] : 'Clef not read';
}

/**
 * The clef holding immediately before one bar begins.
 *
 * The sibling of `keyBeforeMeasure`, and the same walk: a clef is printed once
 * and holds until another is printed, so the answer is the last one stamped at
 * or before this bar, else the clef the page opens in.
 */
export function clefBeforeMeasure(
  score: ScoreJson,
  measureNumber: number,
): Clef | null {
  let clef = score.clef ?? null;
  for (const measure of score.measures) {
    if (measure.measure_number >= measureNumber) {
      break;
    }
    if (measure.clef) {
      clef = measure.clef;
    }
  }
  return clef;
}

/**
 * Apply one deliberate clef correction at the right schema level.
 *
 * The same two normalisations `applyKeySignatureEdit` needs, for the same
 * reasons — and they matter more here. A key written where the page prints
 * none misspells the notes the signature touches; a **clef** written where the
 * page prints none moves every note on the staff by a third or a sixth.
 *
 *  - Choosing the clef **already in force** records no change. The control
 *    asks which clef is *printed at this bar*, and the natural way to read a
 *    list of clefs is "which clef is this bar in" — different questions on
 *    every bar that prints nothing.
 *  - Editing the opening clef **clears any clef stamped on the first bar**,
 *    which otherwise outranks the header and makes the correction a silent
 *    no-op.
 */
export function applyClefEdit(
  score: ScoreJson,
  measureNumber: number,
  value: Clef | null,
): ScoreJson {
  if (score.measures[0]?.measure_number === measureNumber) {
    return {
      ...score,
      clef: value,
      measures: score.measures.map((measure, index) =>
        index === 0 ? { ...measure, clef: null } : measure,
      ),
    };
  }
  const printed = value === clefBeforeMeasure(score, measureNumber) ? null : value;
  return {
    ...score,
    measures: score.measures.map((measure) =>
      measure.measure_number === measureNumber
        ? { ...measure, clef: printed }
        : measure,
    ),
  };
}
