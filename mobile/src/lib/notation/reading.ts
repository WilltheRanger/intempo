import type { Duration, MeasureConcern, ScoreJson } from '../../data/types';
import { BEATS } from '../score/schedule';
import { timeSignatureDigits } from './keySignature';
import { timeSignaturesByMeasure } from './meter';

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
  // The reading of `"N/N"` is `timeSignatureDigits`, not a second regex here.
  //
  // Spaces around the slash are tolerated because the backend tolerates them
  // — `int(" 4 ")` strips, so `ocr/validate.beats_per_measure` reads " 4 / 4 "
  // as 4 beats. This regex did not, so a meter OCR happened to read with
  // spaces switched the app's beat check off while the server went on
  // reporting the same bars as short. Found by running both over the same
  // cases; see `fixtures/meters/parity.json`.
  //
  // That lesson was then written down twice, in two regexes, and only this one
  // is guarded by the parity fixture. Tightening the other would have been
  // silent.
  //
  // A null covers the literal "unknown" too, which the OCR prompt authorises
  // when a score's header is illegible. Not an error — just nothing to check
  // against.
  const digits = timeSignatureDigits(timeSignature);
  if (!digits) {
    return null;
  }
  const perBar = (digits.beats * 4) / digits.unit;
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

/**
 * Whether a short measure is a pickup rather than a fault.
 *
 * **The rule is the backend's and is copied exactly** (`ocr/validate.py`:
 * `index == 0 and actual < expected`). Only the *first* measure of the score
 * can be one; a short measure anywhere else is a dropped or misread note. It
 * must also have something in it — an empty first bar is `empty` there, which
 * is a fault, and forgiving it here would hide a page whose opening was not
 * read at all.
 *
 * **Without this the app flagged the opening bar of most real repertoire.** An
 * anacrusis is how a very large share of music starts — nearly every hymn,
 * most dances, most études — and the local check reported bar 1 as not adding
 * up, on a page that is perfectly correct, and then offered a fix for a bar
 * that needs none. The server had forgiven it all along, so the app contradicted
 * the server the moment it fell back to counting for itself.
 *
 * What it does not copy is `pickup_complement` — the server also checks that
 * the final measure pays the pickup back. That is a whole-score check with a
 * message of its own, and this is deliberately a subset (see `readingNotesFor`).
 * The cost is that a genuinely dropped note in bar 1 is forgiven here and named
 * by the server, which is the right way round.
 */
function isPickup(
  index: number,
  actual: number,
  expected: number,
  noteCount: number,
): boolean {
  return index === 0 && noteCount > 0 && actual < expected - BEAT_TOLERANCE;
}

export function problemMeasures(score: ScoreJson): number[] {
  // **The metre in force at each bar, not the one at the top of the page.**
  // A metre printed mid-piece holds until the next one is printed, and this
  // counted every bar against the header — so on a part that turns 3/4 at bar
  // 20, every correct three-beat bar from 20 onward was flagged as needing a
  // look. Measured on a three-bar score turning 3/4 at bar 2: `[2, 3]`, both
  // of them exactly right.
  //
  // The last of the "header versus in force" family. The metronome, the bar
  // editor and the engraver were each fixed for it; this one decides which
  // bars a musician is *told* to go and check, so it sends them to correct
  // music and leaves the sentence about it true only by coincidence.
  const meters = timeSignaturesByMeasure(score);
  const out: number[] = [];
  score.measures.forEach((measure, index) => {
    // Per bar, because it can change. A bar whose metre is unreadable is
    // skipped rather than aborting the page — before, one unreadable header
    // silenced the check for every bar, including bars that print a metre of
    // their own further down.
    const perBar = beatsPerMeasure(meters.get(measure.measure_number) ?? null);
    if (perBar === null) {
      return;
    }
    const total = beatsIn(measure.notes);
    // A duration this build has never heard of means the app is older than the
    // backend that read the page. That is a bar this version cannot count, not
    // a bar that is wrong — it used to be counted as zero beats, which made a
    // correct measure look short and offered the musician a fix for nothing.
    if (total === null) {
      return;
    }
    if (isPickup(index, total, perBar, measure.notes.length)) {
      return;
    }
    if (Math.abs(total - perBar) > BEAT_TOLERANCE) {
      out.push(measure.measure_number);
    }
  });
  return out;
}

/**
 * What to tell the musician about how this page was read.
 *
 * `concerns` come from the server, which is the only place every check lives:
 * beat sums, broken ties, tuplet ratios, note density, notes the schema cannot
 * write, and bars adrift on a page with no readable metre. **Every one but the
 * beat sum can fire on a measure whose beats add up exactly** — a slur written
 * as a tie sums to 4.0 — so the local beat-sum check silently showed nothing
 * for whole categories of fault, and offered no way to reach the editor for
 * them.
 *
 * Deliberately not a count: the last one written down here said "four" and was
 * wrong within a fortnight. `validate.py` is the inventory.
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
   * That was true while beat sums were the only check. Every other check now
   * fires on measures whose beats add up **exactly** — a slur written as a tie
   * sums to 4.0 — so for those it states a falsehood about the musician's
   * score, and the server has already written the true reason in their terms.
   *
   * `adrift` is the sharpest case and the one that was getting it wrong: it is
   * set only where **no metre could be read**, so "doesn't add up to the time
   * signature" names a time signature the server has just said it could not
   * find. It reached here as `'beats'` until the server gave it its own kind.
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
    const tail = '';
    return others.length === 1
      ? `${capitalise(others[0].detail)}.${tail}`
      : `${others.length} bars look off. ${capitalise(others[0].detail)}.${tail}`;
  }
  if (measures.length > NAMED_LIMIT) {
    return canCheck
      ? `${measures.length} bars don't add up. Try a new photo.`
      : `${measures.length} bars don't add up.`;
  }
  const list =
    measures.length === 1
      ? `Bar ${measures[0]}`
      : `Bars ${measures.slice(0, -1).join(', ')} and ${measures[measures.length - 1]}`;
  const verb = measures.length === 1 ? "doesn't" : "don't";
  return `${list} ${verb} add up.`;
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
  return "The reading wasn't confident about this page. Worth checking against your copy before you record.";
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
  // Deliberately a subset of `Duration`, and always has been — `triplet_half`
  // and `triplet_sixteenth` are not here either. A score can *hold* a
  // quintuplet or a septuplet, and this screen will label one correctly; what
  // it does not do is offer eight more buttons on a control a thumb has to
  // hit. Widening it is a design decision about this screen, not a
  // consequence of the schema knowing a new name.
] as const;

/** How a duration is written on a button. Not the American names — a string
 *  player reads "crotchet" or "quarter" depending on where they trained, and
 *  the note value is unambiguous to both. */
export const DURATION_LABELS: Record<Duration, string> = {
  double_whole: 'Breve',
  dotted_whole: 'Whole ·',
  whole: 'Whole',
  double_dotted_half: 'Half ··',
  dotted_half: 'Half ·',
  half: 'Half',
  double_dotted_quarter: 'Quarter ··',
  dotted_quarter: 'Quarter ·',
  quarter: 'Quarter',
  double_dotted_eighth: 'Eighth ··',
  dotted_eighth: 'Eighth ·',
  eighth: 'Eighth',
  dotted_sixteenth: '16th ·',
  sixteenth: '16th',
  dotted_thirty_second: '32nd ·',
  thirty_second: '32nd',
  dotted_sixty_fourth: '64th ·',
  sixty_fourth: '64th',
  one_twenty_eighth: '128th',
  triplet_breve: 'Breve ³',
  triplet_whole: 'Whole ³',
  triplet_half: 'Half ³',
  triplet_quarter: 'Quarter ³',
  triplet_eighth: 'Eighth ³',
  triplet_sixteenth: '16th ³',
  triplet_thirty_second: '32nd ³',
  triplet_sixty_fourth: '64th ³',
  triplet_one_twenty_eighth: '128th ³',
  quintuplet_breve: 'Breve ⁵',
  quintuplet_whole: 'Whole ⁵',
  quintuplet_half: 'Half ⁵',
  quintuplet_quarter: 'Quarter ⁵',
  quintuplet_eighth: 'Eighth ⁵',
  quintuplet_sixteenth: '16th ⁵',
  quintuplet_thirty_second: '32nd ⁵',
  quintuplet_sixty_fourth: '64th ⁵',
  quintuplet_one_twenty_eighth: '128th ⁵',
  septuplet_breve: 'Breve ⁷',
  septuplet_whole: 'Whole ⁷',
  septuplet_half: 'Half ⁷',
  septuplet_quarter: 'Quarter ⁷',
  septuplet_eighth: 'Eighth ⁷',
  septuplet_sixteenth: '16th ⁷',
  septuplet_thirty_second: '32nd ⁷',
  septuplet_sixty_fourth: '64th ⁷',
  septuplet_one_twenty_eighth: '128th ⁷',
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
 * **Rounded to two places for showing, `BEAT_TOLERANCE` for deciding.** Two
 * different jobs, and this docstring used to describe rounding as the
 * comparison — left over from the inline `0.01` that `BEAT_TOLERANCE`
 * replaced.
 *
 * Rounding is safe for display because the smallest note this schema knows is
 * a thirty-second, so a *real* error is never within 0.005 of correct. Anything
 * that close is floating point: an ordinary bar of half + quarter + eighth +
 * three triplet-sixteenths sums to 3.9999999999999996, and a musician editing
 * it should read "4 of 4 beats".
 *
 * That bar used to read "**4. of 4 beats**" — `toFixed(2)` gave "4.00" and
 * stripping trailing zeros left the decimal point behind.
 */
export function describeBeats(
  notes: { duration: string }[],
  timeSignature: string | null,
  /**
   * Whether this is the score's first measure, which may legitimately be short.
   *
   * The edit screen knows which bar it is showing; this function does not, and
   * without being told it called the opening bar of every piece with an
   * anacrusis unbalanced and invited a correction to it.
   */
  { first = false }: { first?: boolean } = {},
): {
  text: string;
  balanced: boolean;
  expected: number | null;
  /** Short, and allowed to be, because it opens the piece. */
  pickup: boolean;
} {
  const expected = beatsPerMeasure(timeSignature);
  const actual = beatsIn(notes);
  if (actual === null) {
    // Unreachable from a score this build's schema accepted, and handled anyway
    // rather than shown as a confident wrong number.
    return { text: 'Beats not counted', balanced: true, expected: null, pickup: false };
  }
  // `parseFloat` rather than a trailing-zero strip: "4.00" -> 4 -> "4", where
  // `.replace(/0+$/, '')` left "4." on the screen.
  const shown = String(parseFloat(actual.toFixed(2)));
  if (expected === null) {
    // No time signature was read, so there is nothing to balance against.
    // Saying "4 beats" is still useful; claiming it is right would not be.
    return { text: `${shown} beats`, balanced: true, expected: null, pickup: false };
  }
  if (isPickup(first ? 0 : 1, actual, expected, notes.length)) {
    // The backend's own words for this measure, so the two never disagree in
    // front of a musician: "allowed, a first measure may be a pickup".
    return {
      text: `${shown} of ${expected} beats, a pickup`,
      balanced: true,
      expected,
      pickup: true,
    };
  }
  return {
    text: `${shown} of ${expected} beats`,
    balanced: Math.abs(actual - expected) < BEAT_TOLERANCE,
    expected,
    pickup: false,
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
