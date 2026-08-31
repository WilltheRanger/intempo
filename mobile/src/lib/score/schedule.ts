import type { Duration, ScoreJson } from '../../data/types';
import { flattenNotes, readTies } from '../notation/ties';
import { measuresInPlayOrder } from './playOrder';

/**
 * A score and a tempo, turned into notes with times and pitches.
 *
 * Pure, and separate from anything that makes sound, because this is the part
 * that can be wrong in ways nobody hears until they're already confused: a
 * dotted quarter counted as a quarter shifts everything after it, and the
 * mistake sounds like the piece, just wrong.
 *
 * The same walk the analysis pipeline does server-side in
 * `alignment.build_timeline` — accumulate beats, scale by the tempo. Kept
 * deliberately parallel so a note the app plays at 2.5s is the note the
 * pipeline expects at 2.5s.
 */

/** Beats per note value, at any tempo. A dot adds half again. */
export const BEATS: Record<Duration, number> = {
  whole: 4,
  dotted_whole: 6,
  half: 2,
  dotted_half: 3,
  quarter: 1,
  dotted_quarter: 1.5,
  eighth: 0.5,
  dotted_eighth: 0.75,
  sixteenth: 0.25,
  dotted_sixteenth: 0.375,
  thirty_second: 0.125,
  dotted_thirty_second: 0.1875,
  sixty_fourth: 0.0625,
  double_whole: 8,
  // A double dot adds half the dot again: base x 1.75. Ordinary notation, and
  // how a march is written — see score_schema.py for what leaving them out
  // cost on both the import and the OCR side.
  double_dotted_half: 3.5,
  double_dotted_quarter: 1.75,
  double_dotted_eighth: 0.875,
  // Three in the time of two. Thirds are not exactly representable in binary,
  // which is why every beat-sum comparison carries a tolerance rather than
  // testing equality — see TOLERANCE in backend services/ocr/validate.py.
  triplet_half: 4 / 3,
  triplet_quarter: 2 / 3,
  triplet_eighth: 1 / 3,
  triplet_sixteenth: 1 / 6,
};

/**
 * What to sound a duration this build does not recognise as.
 *
 * Only reachable if the backend has learned a note value the app has not, and
 * only for playback — the beat *check* refuses to count such a bar rather than
 * guessing (`reading.beatsOf` returns null). A quarter is the least-wrong
 * guess: the note is audible and the drift is one beat, where silence would
 * make the musician think the app had lost the passage.
 */
const UNKNOWN_DURATION_BEATS = 1;

/** Semitones above C for each letter, before any accidental. */
const SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const PITCH = /^([A-G])(#|b)?(-?\d+)$/;

/**
 * Scientific pitch to frequency in hertz. Null for a rest or anything
 * unparseable — a score from OCR can contain surprises, and a wrong note is
 * worse than a silent one.
 *
 * A4 = 440 Hz, equal temperament. Not configurable: a musician tuning to 442
 * is tuning their instrument, not the app, and a playback reference that
 * disagreed with their tuner would be a bug report.
 */
export function frequencyOf(pitch: string): number | null {
  const match = PITCH.exec(pitch);
  if (!match) {
    return null;
  }
  const [, letter, accidental, octave] = match;
  const semitone =
    SEMITONES[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  // MIDI 69 is A4. Octave 4 starts at MIDI 60.
  const midi = (Number(octave) + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface ScheduledNote {
  /** Seconds from the start of playback. */
  startS: number;
  /** How long the note sounds. Rests are absent, not zero-length notes. */
  durationS: number;
  frequency: number;
  measureNumber: number;
  /** Index among sounded notes, so a playhead can name what it's on. */
  globalIndex: number;
}

export interface Schedule {
  notes: ScheduledNote[];
  /** Total length including any trailing rest, so playback ends when the piece does. */
  durationS: number;
  bpm: number;
}

export interface ScheduleOptions {
  /**
   * Fraction of its written value a note actually sounds for, leaving a gap
   * before the next. Without it every note runs into the next one and a scale
   * becomes a siren — the ear reads the gap, not the attack, as separation.
   */
  articulation?: number;
  /** Silence before the first note, for a count-in to sit in. */
  leadInS?: number;
}

const DEFAULT_ARTICULATION = 0.85;

/**
 * Walk the score, emitting one entry per sounded note.
 *
 * Rests advance the clock and emit nothing. Ties are folded into the note they
 * start on, so a note tied across a barline sounds once for its whole length
 * rather than being re-struck — re-striking is precisely the error a musician
 * would hear.
 *
 * Repeats and first/second endings follow the same performed order as backend
 * alignment. A reference that skips a repeat teaches a different timeline from
 * the one the take is graded against.
 */
export function scheduleScore(
  score: ScoreJson,
  bpm: number,
  { articulation = DEFAULT_ARTICULATION, leadInS = 0 }: ScheduleOptions = {},
): Schedule {
  const secondsPerBeat = 60 / Math.max(1, bpm);
  const notes: ScheduledNote[] = [];

  let clock = leadInS;
  let globalIndex = 0;

  // Walked flat, and the ties read the way the backend reads them. Both matter:
  // a tie across a barline is the commonest kind and the old per-measure loop
  // could not see one, and a tie is only real when both noteheads are the same
  // pitch — otherwise it is a slur, which sounds as separate notes. See
  // `notation/ties.ts`.
  const measures = measuresInPlayOrder(score);
  const flat = flattenNotes(measures);
  const ties = readTies(measures);
  // Which measure each flat note belongs to, so a scheduled note can still say.
  const measureOf: number[] = [];
  for (const measure of measures) {
    for (const _ of measure.notes ?? []) {
      measureOf.push(measure.measure_number);
    }
  }

  for (let i = 0; i < flat.length; i += 1) {
    if (ties.absorbed[i]) {
      continue; // already sounding, as part of the note that tied into it
    }
    const note = flat[i];
    let beats = BEATS[note.duration] ?? UNKNOWN_DURATION_BEATS;
    for (let held = i + 1; held < flat.length && ties.absorbed[held]; held += 1) {
      beats += BEATS[flat[held].duration] ?? UNKNOWN_DURATION_BEATS;
    }

    const durationS = beats * secondsPerBeat;
    const frequency = note.pitch === 'rest' ? null : frequencyOf(note.pitch);

    if (frequency !== null) {
      notes.push({
        startS: clock,
        durationS: durationS * articulation,
        frequency,
        measureNumber: measureOf[i],
        globalIndex,
      });
      globalIndex += 1;
    }

    clock += durationS;
  }

  return { notes, durationS: clock, bpm };
}
