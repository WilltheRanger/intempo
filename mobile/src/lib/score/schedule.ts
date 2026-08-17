import type { Duration, ScoreJson, ScoreNote } from '../../data/types';

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
const BEATS: Record<Duration, number> = {
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
};

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
 * **Repeats are not followed.** `score_json` carries them and this plays
 * straight through. Listening to a passage is the use here, and a repeat that
 * doubles the length of a preview is more surprising than useful. If that
 * changes, it belongs here rather than in a player.
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

  for (const measure of score.measures ?? []) {
    const measureNotes = measure.notes ?? [];

    for (let i = 0; i < measureNotes.length; i += 1) {
      const note = measureNotes[i];
      let beats = BEATS[note.duration] ?? 1;

      // A tie chain sounds as one note. Absorb every note it runs into, then
      // skip past them so they don't sound on their own.
      let held: ScoreNote = note;
      while (held.tied_to_next && i + 1 < measureNotes.length) {
        i += 1;
        held = measureNotes[i];
        beats += BEATS[held.duration] ?? 1;
      }

      const durationS = beats * secondsPerBeat;
      const frequency = note.pitch === 'rest' ? null : frequencyOf(note.pitch);

      if (frequency !== null) {
        notes.push({
          startS: clock,
          durationS: durationS * articulation,
          frequency,
          measureNumber: measure.measure_number,
          globalIndex,
        });
        globalIndex += 1;
      }

      clock += durationS;
    }
  }

  return { notes, durationS: clock, bpm };
}
