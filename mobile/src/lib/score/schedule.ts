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
  double_whole: 8,
  dotted_whole: 6,
  whole: 4,
  double_dotted_half: 7 / 2,
  dotted_half: 3,
  half: 2,
  double_dotted_quarter: 7 / 4,
  dotted_quarter: 3 / 2,
  quarter: 1,
  double_dotted_eighth: 7 / 8,
  dotted_eighth: 3 / 4,
  eighth: 1 / 2,
  dotted_sixteenth: 3 / 8,
  sixteenth: 1 / 4,
  dotted_thirty_second: 3 / 16,
  thirty_second: 1 / 8,
  dotted_sixty_fourth: 3 / 32,
  sixty_fourth: 1 / 16,
  one_twenty_eighth: 1 / 32,
  triplet_breve: 16 / 3,
  triplet_whole: 8 / 3,
  triplet_half: 4 / 3,
  triplet_quarter: 2 / 3,
  triplet_eighth: 1 / 3,
  triplet_sixteenth: 1 / 6,
  triplet_thirty_second: 1 / 12,
  triplet_sixty_fourth: 1 / 24,
  triplet_one_twenty_eighth: 1 / 48,
  quintuplet_breve: 32 / 5,
  quintuplet_whole: 16 / 5,
  quintuplet_half: 8 / 5,
  quintuplet_quarter: 4 / 5,
  quintuplet_eighth: 2 / 5,
  quintuplet_sixteenth: 1 / 5,
  quintuplet_thirty_second: 1 / 10,
  quintuplet_sixty_fourth: 1 / 20,
  quintuplet_one_twenty_eighth: 1 / 40,
  septuplet_breve: 32 / 7,
  septuplet_whole: 16 / 7,
  septuplet_half: 8 / 7,
  septuplet_quarter: 4 / 7,
  septuplet_eighth: 2 / 7,
  septuplet_sixteenth: 1 / 7,
  septuplet_thirty_second: 1 / 14,
  septuplet_sixty_fourth: 1 / 28,
  septuplet_one_twenty_eighth: 1 / 56,
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

/**
 * The same performance, entered at a chosen bar.
 *
 * **Trimmed by time, not by measure number**, and that is the whole design.
 * `measuresInPlayOrder` expands repeats, so bar 5 of a piece with a repeat is
 * played twice and "notes in bar 5 or later" is not a thing that exists — it
 * would keep the second pass through bars 1–4 and drop nothing useful. What a
 * musician means by "start at bar 5" is *the first time bar 5 is played, then
 * carry on*, including the repeat back to bar 1 if that is what the page says.
 * So this finds the earliest note that belongs to that bar and keeps
 * everything from there.
 *
 * A note **tied into** the start bar is not replayed. It began before you did;
 * re-striking it would sound a note the page does not have, which is exactly
 * the error a musician would hear.
 *
 * A bar the piece never reaches — past the end, or one whose every note was a
 * rest — returns the schedule unchanged rather than silence. Playing from the
 * top is a recoverable surprise; a button that does nothing is not.
 */
export function startAtMeasure(schedule: Schedule, measureNumber: number): Schedule {
  const first = schedule.notes.find((note) => note.measureNumber === measureNumber);
  if (!first) {
    return schedule;
  }

  const offset = first.startS;
  const notes = schedule.notes
    .filter((note) => note.startS >= offset)
    .map((note, index) => ({
      ...note,
      startS: note.startS - offset,
      // Renumbered, because `globalIndex` is what a playhead uses to say which
      // note is sounding, and it has to index the notes actually being played.
      globalIndex: index,
    }));

  return {
    ...schedule,
    notes,
    durationS: Math.max(0, schedule.durationS - offset),
  };
}

/**
 * Every bar a listener could sensibly start from, in the order they are played.
 *
 * Read off the schedule rather than the score so it can only ever offer bars
 * that actually sound — a bar of rests has nothing to enter on, and a picker
 * that offers it produces a Listen that appears to do nothing. Deduplicated,
 * because a repeat plays the same bar twice and a picker should list it once.
 */
export function startableMeasures(schedule: Schedule): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const note of schedule.notes) {
    if (!seen.has(note.measureNumber)) {
      seen.add(note.measureNumber);
      out.push(note.measureNumber);
    }
  }
  return out;
}
