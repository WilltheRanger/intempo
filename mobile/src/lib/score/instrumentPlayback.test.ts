import { expect, it } from 'vitest';
import { instrumentPlayback } from './instrumentPlayback';
import { scheduleScore } from './schedule';
import type { ScoreJson } from '../../data/types';

it('sounds bass E2 at E1 without changing the score or timing', () => {
  const score = {
    clef: 'bass',
    time_signature: '4/4',
    measures: [
      {
        measure_number: 1,
        notes: [{ pitch: 'E2', duration: 'quarter', tied_to_next: false }],
        slurs: [],
      },
    ],
    repeats: [],
  } as unknown as ScoreJson;
  const written = scheduleScore(score, 60);
  const bass = instrumentPlayback(written, 'double_bass');
  expect(bass.notes[0].frequency).toBeCloseTo(41.2034, 3);
  expect(bass.notes[0].startS).toBe(written.notes[0].startS);
  expect(bass.durationS).toBe(written.durationS);
  expect(written.notes[0].frequency).toBeCloseTo(82.4069, 3);
  expect(instrumentPlayback(written, 'cello')).toBe(written);
  expect(instrumentPlayback(written, 'viola')).toBe(written);
  expect(instrumentPlayback(written, 'violin')).toBe(written);
});
