import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { soundingMeasureAt } from './playhead';
import { scheduleScore, type Schedule } from './schedule';

/**
 * The bar a playhead names.
 *
 * This rule shipped twice, byte-identical, inside two screens — and being
 * inside a `.tsx` meant neither copy was tested. What it decides is what a
 * musician sees lit while they listen, so getting it wrong points at the wrong
 * bar rather than failing.
 */

function quarters(measureNumber: number, pitches: string[]) {
  return {
    measure_number: measureNumber,
    notes: pitches.map((pitch) => ({ pitch, duration: 'quarter', tied_to_next: false })),
    slurs: [],
  };
}

function scoreOf(measures: ReturnType<typeof quarters>[]): ScoreJson {
  return {
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: null,
    clef: 'treble',
    measures,
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
  } as ScoreJson;
}

/** Two bars of four crotchets at 60 bpm, so one note is exactly one second. */
const SCHEDULE: Schedule = scheduleScore(
  scoreOf([quarters(1, ['C4', 'D4', 'E4', 'F4']), quarters(2, ['G4', 'A4', 'B4', 'C5'])]),
  60,
);

describe('naming the sounding bar', () => {
  it('is silent before the first note', () => {
    // Null rather than bar one: a lead-in sits here, and lighting the first bar
    // through it says the piece has started when it has not.
    expect(soundingMeasureAt(SCHEDULE, -0.5)).toBeNull();
  });

  it('names the bar a note starts in, on the instant it starts', () => {
    expect(soundingMeasureAt(SCHEDULE, 0)).toBe(1);
    expect(soundingMeasureAt(SCHEDULE, 4)).toBe(2);
  });

  it('holds the bar between notes rather than blinking off', () => {
    // **The whole rule.** `articulation` leaves a gap before the next note; the
    // nearest note is sometimes the one that has not started yet, and the ear
    // is still on the one that has.
    expect(soundingMeasureAt(SCHEDULE, 3.99)).toBe(1);
    expect(soundingMeasureAt(SCHEDULE, 4.01)).toBe(2);
  });

  it('stays on the last bar after the last note has started', () => {
    // Playback ends at the schedule's duration, not at the last onset. Going
    // null here would blank the readout through the final note.
    expect(soundingMeasureAt(SCHEDULE, 999)).toBe(2);
  });

  it('has nothing to say without a schedule or a clock', () => {
    expect(soundingMeasureAt(null, 3)).toBeNull();
    expect(soundingMeasureAt(undefined, 3)).toBeNull();
    expect(soundingMeasureAt(SCHEDULE, null)).toBeNull();
  });

  it('names nothing in a schedule with no notes', () => {
    expect(soundingMeasureAt(scheduleScore(scoreOf([]), 60), 5)).toBeNull();
  });
});

describe('the assumption the scan rests on', () => {
  it('is that the schedule is in time order', () => {
    // `soundingMeasureAt` stops at the first note that has not started, which
    // is only correct while this holds. It is the caller that would silently
    // return the wrong bar if `scheduleScore` ever stopped sorting, so the
    // assumption is pinned here rather than left as a comment.
    const starts = SCHEDULE.notes.map((note) => note.startS);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
