import type { Clef, ScoreJson, ScoreMeasure, ScoreNote } from '../../data/types';
import type { MeasureMarks } from '../../lib/notation/spans';
import { timeSignaturesByMeasure } from '../../lib/notation/meter';
import { clefBeforeMeasure } from './clefEdit';
import { keyBeforeMeasure } from './keySignatureEdit';

/**
 * One bar as a score of its own, so the screens that correct a reading can
 * engrave the bar they are asking about.
 *
 * **Both correcting screens drew no music.** The bar editor listed the notes as
 * text tiles ("Whole / G4") and "Check the reading" asked for C3 or C4 with
 * neither the bar nor its photograph on screen: a musician was asked to fix
 * notation they could not see (four of the five reviews, 2026-11-12). The
 * engraver already draws any `ScoreJson`; this makes the one-bar score it
 * draws.
 *
 * **What is in force at the bar becomes the opening.** A key, clef or metre
 * that changes *at* this bar, and the ones that held before it, are set as the
 * one-bar score's opening, so the excerpt is engraved in the clef and key the
 * bar is read in rather than the page's first. Repeats and tempo marks belong
 * to the page and are left off.
 */

export interface BarContext {
  key: string | null;
  clef: Clef | null;
  meter: string | null;
}

/** The key, clef and metre a bar is read in, its own changes included. */
export function contextAt(score: ScoreJson, measure: ScoreMeasure): BarContext {
  return {
    key: measure.key_signature ?? keyBeforeMeasure(score, measure.measure_number),
    clef: measure.clef ?? clefBeforeMeasure(score, measure.measure_number),
    meter: timeSignaturesByMeasure(score).get(measure.measure_number) ?? score.time_signature,
  };
}

/**
 * The bar engraved on its own. `notes` and `marks` are the working copy
 * where there is one (the editor's unsaved changes); `context` is what the bar
 * is read in.
 */
export function barPreviewScore(
  score: ScoreJson,
  measure: ScoreMeasure,
  context: BarContext,
  working?: { notes: ScoreNote[]; marks: MeasureMarks },
): ScoreJson {
  // The bar's own changes are the opening now, so they come off the bar.
  const {
    key_signature: _key,
    clef: _clef,
    time_signature: _meter,
    ...rest
  } = measure;
  return {
    ...score,
    key_signature: context.key,
    clef: context.clef,
    time_signature: context.meter,
    measures: [
      working
        ? { ...rest, notes: working.notes, slurs: working.marks.slurs, tuplets: working.marks.tuplets }
        : rest,
    ],
    repeats: [],
    tempo_changes: [],
  };
}
