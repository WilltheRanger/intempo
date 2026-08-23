import type { MeasureConcern, ScoreJson } from '../../data/types';
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
  /** Measure numbers the reading cannot vouch for. */
  problemMeasures: number[];
  /**
   * Why, when the server said. Empty when falling back to the local beat-sum
   * check, which knows the measures but not the reasons.
   */
  concerns: MeasureConcern[];
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
 * A tolerance, because these are floating-point sums of thirds in tuplet-heavy
 * music and an exact comparison would report rounding as a misreading.
 */

/**
 * How far a bar may be from its meter and still count as adding up.
 *
 * Matches `TOLERANCE` in the backend's `services/ocr/validate.py`, and it has
 * to: the backend decides which bars are worth re-reading, this decides which
 * bars the app offers to fix, and a musician seeing "bar 7 doesn't add up" with
 * no way to open bar 7 is the app disagreeing with itself in front of them.
 *
 * `describeBeats` carried its own inline `0.01` for the same question, so the
 * edit screen could call a bar balanced while the score screen still listed it
 * as a problem. One constant now, and both use it.
 */
export const BEAT_TOLERANCE = 1e-6;

export function problemMeasures(score: ScoreJson): number[] {
  const perBar = beatsPerMeasure(score.time_signature);
  if (perBar === null) {
    return [];
  }
  const out: number[] = [];
  for (const measure of score.measures) {
    const total = beatsIn(measure.notes);
    // A duration this build has never heard of means the app is older than the
    // backend that read the page. That is a bar this version cannot count, not
    // a bar that is wrong — it used to be counted as zero beats, which made a
    // correct measure look short and offered the musician a fix for nothing.
    if (total === null) {
      continue;
    }
    if (Math.abs(total - perBar) > BEAT_TOLERANCE) {
      out.push(measure.measure_number);
    }
  }
  return out;
}

/**
 * What to tell the musician about how this page was read.
 *
 * `concerns` come from the server, which is the only place all four checks
 * live: beat sums, broken ties, tuplet ratios and note density. The last three
 * can each fire on a measure whose beats add up **exactly** — a slur written as
 * a tie sums to 4.0 — so the local beat-sum check silently showed nothing for
 * whole categories of fault, and offered no way to reach the editor for them.
 *
 * The local check remains as the fallback, for a backend that predates the
 * field and for a score being edited before it has been saved. It is a subset
 * and is meant to be.
 */
export function readingNotesFor(
  score: ScoreJson,
  concerns?: MeasureConcern[],
): ReadingNotes {
  const fromServer = concerns?.map((c) => c.measure_number) ?? null;
  return {
    problemMeasures: fromServer ?? problemMeasures(score),
    concerns: concerns ?? [],
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

/** "measure 3: …" reads better as "Measure 3: …" at the start of a sentence. */
function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}


export function describeProblemMeasures(
  measures: number[],
  /**
   * Why each bar was flagged, when the server said.
   *
   * The sentence below claims the bars "don't add up to the time signature".
   * That was true while beat sums were the only check. Three of the four now
   * fire on measures whose beats add up **exactly** — a slur written as a tie
   * sums to 4.0 — so for those it states a falsehood about the musician's
   * score, and the server has already written the true reason in their terms.
   */
  /**
   * Whether the musician still has the page to compare against.
   *
   * False once the transcription has been accepted and the photograph
   * discarded. The bars still don't add up — that is a fact about the score
   * and it still skews the verdict — but "check it against your copy" has
   * stopped being something they can act on, and advice you cannot follow is
   * worse than none.
   */
  { canCheck = true, concerns = [] }: { canCheck?: boolean; concerns?: MeasureConcern[] } = {},
): string | null {
  if (measures.length === 0) {
    return null;
  }

  // Only the beat-sum wording can promise arithmetic. Anything else says what
  // the server found, which is already a sentence written for a musician.
  const others = concerns.filter((c) => c.kind !== 'beats');
  if (others.length > 0) {
    const tail = canCheck ? ' Check it against your copy.' : '';
    return others.length === 1
      ? `${capitalise(others[0].detail)}.${tail}`
      : `${others.length} bars need a second look. ${capitalise(others[0].detail)}.${tail}`;
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

/** The durations a musician can choose from, shortest last. */
export const EDITABLE_DURATIONS = [
  'whole',
  'dotted_half',
  'half',
  'dotted_quarter',
  'quarter',
  'dotted_eighth',
  'eighth',
  'sixteenth',
  // Offered last: a triplet is rarer than a plain value, and a musician
  // reaching for one knows what they are looking for.
  'triplet_quarter',
  'triplet_eighth',
] as const;

/** How a duration is written on a button. Not the American names — a string
 *  player reads "crotchet" or "quarter" depending on where they trained, and
 *  the note value is unambiguous to both. */
export const DURATION_LABELS: Record<string, string> = {
  whole: 'Whole',
  dotted_whole: 'Whole ·',
  half: 'Half',
  dotted_half: 'Half ·',
  quarter: 'Quarter',
  dotted_quarter: 'Quarter ·',
  eighth: 'Eighth',
  dotted_eighth: 'Eighth ·',
  sixteenth: '16th',
  dotted_sixteenth: '16th ·',
  thirty_second: '32nd',
  triplet_half: 'Half ³',
  triplet_quarter: 'Quarter ³',
  triplet_eighth: 'Eighth ³',
  triplet_sixteenth: '16th ³',
};

/**
 * Beats a duration is worth, or null if this build does not know the duration.
 *
 * Nullable rather than defaulted. The two defaults this replaced disagreed with
 * each other — `?? 0` here and `?? 1` in `schedule.ts` — so the same unknown
 * duration made a bar look short in one place and shifted the metronome in the
 * other, both silently.
 */
export function beatsOf(duration: string): number | null {
  const beats = BEATS[duration as keyof typeof BEATS];
  return beats === undefined ? null : beats;
}

/** What a measure's notes add up to, or null if any of them cannot be counted. */
export function beatsIn(notes: { duration: string }[]): number | null {
  let total = 0;
  for (const note of notes) {
    const beats = beatsOf(note.duration);
    if (beats === null) {
      return null;
    }
    total += beats;
  }
  return total;
}

/**
 * The beat total as a sentence, and whether it balances.
 *
 * Rounded to two places before comparing: these are sums of thirds and
 * sevenths in tuplet-heavy music, and an exact comparison would call a
 * correctly-fixed bar broken because of floating point.
 */
export function describeBeats(
  notes: { duration: string }[],
  timeSignature: string | null,
): { text: string; balanced: boolean; expected: number | null } {
  const expected = beatsPerMeasure(timeSignature);
  const actual = beatsIn(notes);
  if (actual === null) {
    // Unreachable from a score this build's schema accepted, and handled anyway
    // rather than shown as a confident wrong number.
    return { text: 'Beats not counted', balanced: true, expected: null };
  }
  const shown = Number.isInteger(actual) ? String(actual) : actual.toFixed(2).replace(/0+$/, '');
  if (expected === null) {
    // No time signature was read, so there is nothing to balance against.
    // Saying "4 beats" is still useful; claiming it is right would not be.
    return { text: `${shown} beats`, balanced: true, expected: null };
  }
  return {
    text: `${shown} of ${expected} beats`,
    balanced: Math.abs(actual - expected) < BEAT_TOLERANCE,
    expected,
  };
}

/** Note names in order, for stepping a pitch up or down. */
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/**
 * The next pitch up or down, keeping any accidental.
 *
 * By letter, not by semitone. A musician correcting a misread notehead is
 * moving it a line or a space on the staff, which is a letter step — stepping
 * by semitone would make F♯ → G a *different* correction from F → F♯ and put
 * the note somewhere they did not point at.
 *
 * Returns the pitch unchanged at the ends of the range rather than wrapping:
 * C0 is already below anything a string instrument plays, and silently
 * jumping eight octaves would be a worse answer than refusing.
 */
export function stepPitch(pitch: string, direction: 1 | -1): string {
  const match = /^([A-G])([#b]?)(\d)$/.exec(pitch);
  if (!match) {
    return pitch;
  }
  const [, letter, accidental, octaveText] = match;
  let index = LETTERS.indexOf(letter as (typeof LETTERS)[number]) + direction;
  let octave = Number(octaveText);
  if (index > 6) {
    index = 0;
    octave += 1;
  } else if (index < 0) {
    index = 6;
    octave -= 1;
  }
  if (octave < 0 || octave > 8) {
    return pitch;
  }
  return `${LETTERS[index]}${accidental}${octave}`;
}

/** Cycles natural → sharp → flat → natural on the note the musician selected. */
export function cycleAccidental(pitch: string): string {
  const match = /^([A-G])([#b]?)(\d)$/.exec(pitch);
  if (!match) {
    return pitch;
  }
  const [, letter, accidental, octave] = match;
  const next = accidental === '' ? '#' : accidental === '#' ? 'b' : '';
  return `${letter}${next}${octave}`;
}
