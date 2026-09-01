import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { FALLBACK_BPM, scheduleScore } from './schedule';

describe('a tempo that is not a number', () => {
  /**
   * **`Math.max(1, NaN)` is `NaN`**, so the clamp that looks like a guard is
   * not one. A non-finite tempo propagated into every note's start and
   * duration, and Web Audio throws on a non-finite time — out of the middle of
   * the scheduling loop, after earlier notes had already been started, with
   * nothing returned that could stop them.
   */
  const TWO_NOTES: ScoreJson = {
    time_signature: '4/4',
    key_signature: 'C major',
    tempo_marking: null,
    bpm_hint: null,
    clef: 'treble',
    measures: [
      {
        measure_number: 1,
        notes: [
          { pitch: 'D4', duration: 'quarter', tied_to_next: false },
          { pitch: 'E4', duration: 'quarter', tied_to_next: false },
        ],
        slurs: [],
      },
    ],
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
  };

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'still produces a playable schedule at %s BPM',
    (bpm) => {
      const schedule = scheduleScore(TWO_NOTES, bpm);

      expect(Number.isFinite(schedule.durationS)).toBe(true);
      expect(schedule.durationS).toBeGreaterThan(0);
      for (const note of schedule.notes) {
        expect(Number.isFinite(note.startS)).toBe(true);
        expect(Number.isFinite(note.durationS)).toBe(true);
        expect(note.durationS).toBeGreaterThan(0);
      }
    },
  );

  it('agrees with the tempo store about what "no usable tempo" sounds like', () => {
    // One constant, re-exported by `practiceTempo`, so there is nothing to
    // drift. This pins the behaviour rather than the number.
    expect(scheduleScore(TWO_NOTES, Number.NaN).durationS).toBe(
      scheduleScore(TWO_NOTES, FALLBACK_BPM).durationS,
    );
  });
});
