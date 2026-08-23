import type { ScoreJson } from '../../data/types';
import { BEATS } from '../score/schedule';

/**
 * What to say about how well a page was read.
 *
 * OCR does not fail cleanly. It fails by returning a transcription that is
 * mostly right, and the parts that are wrong look exactly like the parts that
 * are not — which is the whole problem with putting one in front of a musician
 * unannotated. They will practise against it, and the first they will know is
 * a verdict built on a bar that was never there.
 *
 * So the two things worth surfacing are the two the app can actually check:
 * what the model said about its own reading, and the one thing that is not an
 * opinion — whether each bar's durations add up to its time signature.
 */
export interface ReadingNotes {
  /** Measure numbers whose durations do not fill the bar. */
  problemMeasures: number[];
  /** The model's own estimate of its reading, 0–1, or null if it gave none. */
  confidence: number | null;
  /** What the model chose to say about this page. Empty string when nothing. */
  notes: string;
}

/** Beats in one bar of a `"N/N"` time signature, or null if it isn't one. */
export function beatsPerMeasure(timeSignature: string | null): number | null {
  if (!timeSignature) {
    return null;
  }
  const match = /^(\d+)\/(\d+)$/.exec(timeSignature.trim());
  if (!match) {
    // Includes the literal "unknown", which the OCR prompt authorises when a
    // score's header is illegible. Not an error — just nothing to check against.
    return null;
  }
  const [, beats, unit] = match;
  const perBar = (Number(beats) * 4) / Number(unit);
  return Number.isFinite(perBar) && perBar > 0 ? perBar : null;
}

/**
 * Measures whose durations do not fill the bar.
 *
 * The same arithmetic the backend runs in `ocr/validate.py`, for the same
 * reason: `alignment.py` builds its expected timeline out of these durations,
 * so one bad measure pushes every measure after it out of step. A bar that
 * contradicts its own time signature is wrong however confident the model was.
 *
 * Empty when the time signature is unknown — there is nothing to compare
 * against, and inventing 4/4 would flag every waltz on the page.
 *
 * A tolerance, because these are floating-point sums of thirds and sevenths in
 * tuplet-heavy music and an exact comparison would report rounding as a
 * misreading.
 */
const TOLERANCE = 0.01;

export function problemMeasures(score: ScoreJson): number[] {
  const perBar = beatsPerMeasure(score.time_signature);
  if (perBar === null) {
    return [];
  }
  const out: number[] = [];
  for (const measure of score.measures) {
    const total = measure.notes.reduce(
      (sum, note) => sum + (BEATS[note.duration] ?? 0),
      0,
    );
    if (Math.abs(total - perBar) > TOLERANCE) {
      out.push(measure.measure_number);
    }
  }
  return out;
}

export function readingNotesFor(score: ScoreJson): ReadingNotes {
  return {
    problemMeasures: problemMeasures(score),
    confidence: typeof score.ocr_confidence === 'number' ? score.ocr_confidence : null,
    notes: score.notes_to_human ?? '',
  };
}

/**
 * The bars that don't add up, as a sentence, or null when they all do.
 *
 * Names them rather than counting them. "3 measures don't add up" leaves a
 * musician to find which; the numbers are printed on their own copy of the
 * music, so naming them is the difference between a warning and an
 * instruction. Long lists are trimmed — past a handful the specifics stop
 * helping and the honest summary is that the page needs another look.
 */
const NAMED_LIMIT = 6;

export function describeProblemMeasures(
  measures: number[],
  /**
   * Whether the musician still has the page to compare against.
   *
   * False once the transcription has been accepted and the photograph
   * discarded. The bars still don't add up — that is a fact about the score
   * and it still skews the verdict — but "check it against your copy" has
   * stopped being something they can act on, and advice you cannot follow is
   * worse than none.
   */
  { canCheck = true }: { canCheck?: boolean } = {},
): string | null {
  if (measures.length === 0) {
    return null;
  }
  if (measures.length > NAMED_LIMIT) {
    return canCheck
      ? `${measures.length} bars don't add up to the time signature. This page may need re-photographing.`
      : `${measures.length} bars don't add up to the time signature, so timing after them may be off.`;
  }
  const list =
    measures.length === 1
      ? `Bar ${measures[0]}`
      : `Bars ${measures.slice(0, -1).join(', ')} and ${measures[measures.length - 1]}`;
  const verb = measures.length === 1 ? "doesn't" : "don't";
  const tail = canCheck
    ? ` — check ${measures.length === 1 ? 'it' : 'them'} against your copy.`
    : ', so timing after that point may be off.';
  return `${list} ${verb} add up to the time signature${tail}`;
}

/**
 * The same threshold the backend's provider chain uses.
 *
 * Below it, `pipeline.py` keeps a reading as a fallback but goes on looking
 * for a better one — so a transcription that arrives under this bar is one
 * nothing better was found for.
 */
const LOW_CONFIDENCE = 0.7;

/**
 * A word about the model's own confidence, or null when there is nothing
 * useful to say.
 *
 * **Only when it is low.** A percentage next to a good reading is noise: it
 * invites a musician to weigh a number that is the model marking its own
 * homework, and the bake-off showed how little that is worth — one provider
 * reported 0.90 and another 0.32 for the same page. What it is good for is the
 * one direction it is hard to be wrong in: a model that says it is unsure
 * usually had a reason.
 *
 * No number in the sentence either, for the same reason. "62% confident" reads
 * as a measurement; "wasn't confident" is what it actually means.
 */
export function describeConfidence(confidence: number | null): string | null {
  if (confidence === null || confidence >= LOW_CONFIDENCE) {
    return null;
  }
  return "The reading wasn't confident about this page — worth checking against your copy before you record.";
}
