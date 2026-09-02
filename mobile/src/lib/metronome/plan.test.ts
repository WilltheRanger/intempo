import { describe, expect, it } from 'vitest';

import type { Duration, ScoreJson } from '../../data/types';
import { buildMetronomePlan } from './plan';

function note(duration: Duration = 'quarter') {
  return { pitch: 'E2', duration, tied_to_next: false } as const;
}

function score(): ScoreJson {
  return {
    clef: 'bass',
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: 60,
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
    measures: [
      { measure_number: 1, notes: [note('whole')], slurs: [] },
      {
        measure_number: 2,
        time_signature: '6/8',
        notes: [note('dotted_half')],
        slurs: [],
      },
      { measure_number: 3, notes: [note('dotted_half')], slurs: [] },
      {
        measure_number: 4,
        time_signature: '3/4',
        notes: [note('dotted_half')],
        slurs: [],
      },
    ],
  };
}

describe('meter-aware metronome plan', () => {
  it('changes pulse speed and bar size where the page changes meter', () => {
    const plan = buildMetronomePlan(score(), 60);
    const take = plan.beats.slice(plan.countInPulses);

    expect(plan.countInPulses).toBe(4);
    expect(take.map((beat) => [beat.atS, beat.beatInBar, beat.pulsesPerBar])).toEqual([
      [4, 0, 4],
      [5, 1, 4],
      [6, 2, 4],
      [7, 3, 4],
      [8, 0, 2],
      [9.5, 1, 2],
      [11, 0, 2],
      [12.5, 1, 2],
      [14, 0, 3],
      [15, 1, 3],
      [16, 2, 3],
    ]);
  });

  it('counts in using a change printed on the entry bar', () => {
    const entered = score();
    entered.measures = entered.measures.slice(1);

    const plan = buildMetronomePlan(entered, 60);
    expect(plan.countInPulses).toBe(2);
    expect(plan.beats.slice(0, 3).map((beat) => beat.atS)).toEqual([0, 1.5, 3]);
  });

  it('restores the earlier meter when a repeat jumps back', () => {
    const repeated = score();
    repeated.repeats = [{ start_measure: 1, end_measure: 2, type: 'repeat' }];

    const take = buildMetronomePlan(repeated, 60).beats.slice(4);
    const downbeats = take.filter((beat) => beat.downbeat);

    expect(downbeats.map((beat) => [beat.atS, beat.pulsesPerBar])).toEqual([
      [4, 4],
      [8, 2],
      [11, 4],
      [15, 2],
      [18, 2],
      [21, 3],
    ]);
  });

  it('uses steady unaccented quarters when the meter is unreadable', () => {
    const unknown = score();
    unknown.time_signature = 'unknown';
    unknown.measures = [
      { measure_number: 1, notes: [note('half')], slurs: [] },
    ];

    const plan = buildMetronomePlan(unknown, 60);
    expect(plan.countInPulses).toBe(4);
    expect(plan.beats.every((beat) => !beat.downbeat)).toBe(true);
    expect(plan.beats.map((beat) => beat.atS)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
