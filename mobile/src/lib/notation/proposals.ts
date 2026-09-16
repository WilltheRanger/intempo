import type { Instrument, ScoreJson, ScoreMeasure } from '../../data/types';
import { beatsIn, beatsPerMeasure } from './reading';
import { timeSignaturesByMeasure } from './meter';
import { midiOf, shiftOctave } from './pitch';

/**
 * Corrections the app is willing to propose, with the reason for each.
 *
 * **The reading can be internally consistent and still wrong.** Measured on the
 * live project: a real 25-bar part came back at exactly 4.00 beats in every
 * bar — arithmetic the beat check is perfectly happy with — and carried C3 on a
 * violin, a note that part cannot play. The screen said nothing, because
 * nothing here was looking for it.
 *
 * **A confidently wrong suggestion is worse than none**, so every rule below is
 * conservative in the same specific way: it fires only where the wrong reading
 * and the right one are both *nameable*, and it proposes the edit rather than
 * making it. The musician accepts or keeps what is there, and keeping is always
 * a real answer — the app is guessing about a page it cannot see.
 *
 * Two rules, and the shape of each is a known OCR failure rather than a
 * plausible-looking heuristic:
 *
 *  - **A pitch below the instrument's lowest string, where an octave up fits.**
 *    That is the signature of a misread clef or a notehead placed a line too
 *    low, and the correction is unambiguous: there is exactly one octave that
 *    brings it into range.
 *  - **A bar over by exactly one of a pair of identical adjacent notes.** A
 *    notehead read twice is the commonest way a bar comes out long, and
 *    dropping the repeat is the only edit that both fixes the arithmetic and
 *    changes nothing else.
 *
 * Bars that are *short* get no proposal. Half a bar missing has no single right
 * answer — which note, and how long? — and inventing one would be the app
 * writing music.
 */

export interface Proposal {
  /** Stable across a rebuild of the list, so a decision survives a redraw. */
  id: string;
  measureNumber: number;
  /** Where, as a musician counts it. */
  where: string;
  /** What the reading says now. */
  from: string;
  /** What this proposes instead. */
  to: string;
  /** Why, in one clause. */
  why: string;
  /** The label on leaving it alone. */
  keepLabel: string;
  /** The label on taking the proposal. */
  fixLabel: string;
  /** The corrected score. Pure: it returns a new score and touches nothing. */
  apply: (score: ScoreJson) => ScoreJson;
}

/**
 * The lowest note each instrument can play, **as written on the page**.
 *
 * Written, not sounding, because that is what a score carries. The double bass
 * is the one where the two differ by an octave, and its floor here is written
 * C2 rather than written E2: a bass with a C extension really does print those
 * notes, and a rule that called them impossible would propose a correction to
 * music that is correct.
 *
 * Every floor is the open string with no scordatura, which is the conservative
 * direction — a tuned-down string makes a real note look impossible, and the
 * cost of that is a proposal a musician has to decline.
 */
const LOWEST_WRITTEN: Record<Instrument, string> = {
  violin: 'G3',
  viola: 'C3',
  cello: 'C2',
  double_bass: 'C2',
};

const INSTRUMENT_NAMES: Record<Instrument, string> = {
  violin: 'violin',
  viola: 'viola',
  cello: 'cello',
  double_bass: 'double bass',
};

function withMeasure(
  score: ScoreJson,
  measureNumber: number,
  change: (measure: ScoreMeasure) => ScoreMeasure,
): ScoreJson {
  return {
    ...score,
    measures: score.measures.map((measure) =>
      measure.measure_number === measureNumber ? change(measure) : measure,
    ),
  };
}

/** A note too low for this instrument, where one octave up lands in range. */
function outOfRange(
  score: ScoreJson,
  instrument: Instrument,
): Proposal[] {
  const floor = midiOf(LOWEST_WRITTEN[instrument]);
  if (floor === null) {
    return [];
  }
  const out: Proposal[] = [];
  for (const measure of score.measures) {
    measure.notes.forEach((note, index) => {
      if (note.pitch === 'rest') {
        return;
      }
      const midi = midiOf(note.pitch);
      const up = shiftOctave(note.pitch, 1);
      if (midi === null || up === null || midi >= floor) {
        return;
      }
      // **One octave, or nothing.** A note more than an octave below the floor
      // is a stranger failure than a misread clef, and moving it two octaves
      // would be the app choosing between explanations it has no evidence for.
      if (midi + 12 < floor) {
        return;
      }
      out.push({
        id: `range-${measure.measure_number}-${index}`,
        measureNumber: measure.measure_number,
        where: `Bar ${measure.measure_number}, note ${index + 1}`,
        from: note.pitch,
        to: up,
        // A typographic apostrophe, like the rest of the app's copy. It is in
        // the font subset (`tools/subset-text-fonts.py`) and a straight quote
        // beside curly ones in the same paragraph is visible.
        why: `${note.pitch} is below a ${INSTRUMENT_NAMES[instrument]}\u2019s lowest string, and an octave up fits the staff`,
        keepLabel: `Keep ${note.pitch}`,
        fixLabel: `Use ${up}`,
        apply: (current) =>
          withMeasure(current, measure.measure_number, (m) => ({
            ...m,
            notes: m.notes.map((n, i) => (i === index ? { ...n, pitch: up } : n)),
          })),
      });
    });
  }
  return out;
}

/** A bar over by exactly one of a pair of identical adjacent notes. */
function repeatedNote(score: ScoreJson): Proposal[] {
  const meters = timeSignaturesByMeasure(score);
  const out: Proposal[] = [];
  for (const measure of score.measures) {
    const expected = beatsPerMeasure(meters.get(measure.measure_number) ?? null);
    const actual = beatsIn(measure.notes);
    if (expected === null || actual === null || actual <= expected) {
      continue;
    }
    for (let index = 1; index < measure.notes.length; index += 1) {
      const note = measure.notes[index];
      const before = measure.notes[index - 1];
      if (note.pitch !== before.pitch || note.duration !== before.duration) {
        continue;
      }
      const without = measure.notes.filter((_, i) => i !== index);
      if (beatsIn(without) !== expected) {
        continue;
      }
      const what = note.pitch === 'rest' ? 'rest' : note.pitch;
      out.push({
        id: `repeat-${measure.measure_number}-${index}`,
        measureNumber: measure.measure_number,
        where: `Bar ${measure.measure_number}`,
        from: `${trimBeats(actual)} beats`,
        to: `${trimBeats(expected)} beats`,
        why: `Two ${what}s in a row read as one note twice. Dropping the repeat makes the bar add up`,
        keepLabel: 'Leave it',
        fixLabel: 'Drop the repeat',
        apply: (current) =>
          withMeasure(current, measure.measure_number, (m) => ({
            ...m,
            notes: m.notes.filter((_, i) => i !== index),
          })),
      });
      // One per bar. A second proposal about the same bar would be arithmetic
      // about a bar the first one has already changed.
      break;
    }
  }
  return out;
}

/** "4.00" reads as 4; "1.50" reads as 1.5. */
function trimBeats(value: number): string {
  return String(parseFloat(value.toFixed(2)));
}

/**
 * Everything worth proposing about a reading, in the order it appears on the
 * page.
 *
 * Sorted by bar rather than by rule, because a musician checking their part
 * works through it from the top and two passes over the same page is the thing
 * this screen exists to save them.
 */
export function proposalsFor(
  score: ScoreJson | null | undefined,
  instrument: Instrument,
): Proposal[] {
  if (!score) {
    return [];
  }
  return [...outOfRange(score, instrument), ...repeatedNote(score)].sort(
    (a, b) => a.measureNumber - b.measureNumber,
  );
}

/** The line under the heading: how many, and what they are. */
export function proposalsSummary(count: number): string {
  if (count === 0) {
    return 'Nothing looks off. The reading is yours to use.';
  }
  return count === 1
    ? 'One thing looks off. Keep it or fix it.'
    : `${count} things look off. Keep or fix each one.`;
}
