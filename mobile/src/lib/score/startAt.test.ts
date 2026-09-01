import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { scheduleScore, startAtMeasure, startableMeasures } from './schedule';

function quarters(measureNumber: number, pitches: string[]) {
  return {
    measure_number: measureNumber,
    notes: pitches.map((pitch) => ({ pitch, duration: 'quarter', tied_to_next: false })),
    slurs: [],
  };
}

function scoreOf(
  measures: ReturnType<typeof quarters>[],
  repeats: ScoreJson['repeats'] = [],
): ScoreJson {
  return {
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: null,
    clef: 'treble',
    measures,
    repeats,
    ocr_confidence: 1,
    notes_to_human: '',
  } as ScoreJson;
}

const FOUR_BARS = scoreOf([
  quarters(1, ['C4', 'D4', 'E4', 'F4']),
  quarters(2, ['G4', 'A4', 'B4', 'C5']),
  quarters(3, ['C5', 'B4', 'A4', 'G4']),
  quarters(4, ['F4', 'E4', 'D4', 'C4']),
]);

describe('startAtMeasure', () => {
  it('begins at the chosen bar, from zero', () => {
    const whole = scheduleScore(FOUR_BARS, 60);
    const fromThree = startAtMeasure(whole, 3);

    expect(fromThree.notes[0].measureNumber).toBe(3);
    expect(fromThree.notes[0].startS).toBe(0);
    // Two bars of four quarters at 60 BPM.
    expect(fromThree.notes).toHaveLength(8);
    expect(fromThree.durationS).toBeCloseTo(8);
  });

  it('keeps the note times relative to each other', () => {
    const whole = scheduleScore(FOUR_BARS, 60);
    const fromTwo = startAtMeasure(whole, 2);
    const offset = whole.notes.find((n) => n.measureNumber === 2)!.startS;

    for (const [index, note] of fromTwo.notes.entries()) {
      const original = whole.notes[whole.notes.length - fromTwo.notes.length + index];
      expect(note.startS).toBeCloseTo(original.startS - offset);
      expect(note.frequency).toBe(original.frequency);
    }
  });

  it('renumbers, because a playhead indexes what is playing', () => {
    const fromThree = startAtMeasure(scheduleScore(FOUR_BARS, 60), 3);

    expect(fromThree.notes.map((n) => n.globalIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('starting at bar 1 changes nothing', () => {
    const whole = scheduleScore(FOUR_BARS, 60);

    expect(startAtMeasure(whole, 1)).toEqual(whole);
  });

  it('plays from the top rather than doing nothing, for a bar that never sounds', () => {
    // A recoverable surprise beats a button that appears broken.
    const whole = scheduleScore(FOUR_BARS, 60);

    expect(startAtMeasure(whole, 99)).toEqual(whole);
  });

  it('enters at the FIRST time a repeated bar is played, and keeps the repeat', () => {
    // **Why this trims by time and not by measure number.** With bars 1–2
    // repeated, the played order is 1 2 1 2 3 4 — so "notes in bar 3 or later"
    // would keep the second pass through 1 and 2 as well, and "start at bar 2"
    // would mean nothing at all. A musician means: the first time bar 2 comes
    // round, then carry on — repeat included.
    const repeated = scoreOf(
      [
        quarters(1, ['C4', 'D4', 'E4', 'F4']),
        quarters(2, ['G4', 'A4', 'B4', 'C5']),
        quarters(3, ['C5', 'B4', 'A4', 'G4']),
      ],
      [{ start_measure: 1, end_measure: 2, type: 'repeat' }],
    );
    const whole = scheduleScore(repeated, 60);
    const fromTwo = startAtMeasure(whole, 2);

    expect(fromTwo.notes[0].measureNumber).toBe(2);
    // Bar 2, then the repeat back to 1 and 2, then 3: four bars of music.
    expect(fromTwo.notes.map((n) => n.measureNumber)).toEqual([
      2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    ]);
  });

  it('does not re-strike a note tied into the chosen bar', () => {
    // It began before you did. Sounding it again is a note the page does not
    // have — exactly the error a musician would hear.
    const tied = scoreOf([
      {
        measure_number: 1,
        notes: [
          { pitch: 'C4', duration: 'half', tied_to_next: false },
          { pitch: 'G4', duration: 'half', tied_to_next: true },
        ],
        slurs: [],
      },
      quarters(2, ['G4', 'A4', 'B4', 'C5']),
    ]);
    const fromTwo = startAtMeasure(scheduleScore(tied, 60), 2);

    // The tie folded bar 2's first G into bar 1's, so bar 2 sounds three notes.
    expect(fromTwo.notes.map((n) => n.measureNumber)).toEqual([2, 2, 2]);
    expect(fromTwo.notes[0].startS).toBe(0);
  });
});

describe('startableMeasures', () => {
  it('lists the bars that actually sound, in playing order', () => {
    expect(startableMeasures(scheduleScore(FOUR_BARS, 60))).toEqual([1, 2, 3, 4]);
  });

  it('leaves out a bar of rests, which has nothing to enter on', () => {
    // A picker that offers it produces a Listen that appears to do nothing.
    const withRest = scoreOf([
      quarters(1, ['C4', 'D4', 'E4', 'F4']),
      quarters(2, ['rest', 'rest', 'rest', 'rest']),
      quarters(3, ['G4', 'A4', 'B4', 'C5']),
    ]);

    expect(startableMeasures(scheduleScore(withRest, 60))).toEqual([1, 3]);
  });

  it('lists a repeated bar once', () => {
    const repeated = scoreOf(
      [quarters(1, ['C4']), quarters(2, ['D4'])],
      [{ start_measure: 1, end_measure: 2, type: 'repeat' }],
    );

    expect(startableMeasures(scheduleScore(repeated, 60))).toEqual([1, 2]);
  });
});
