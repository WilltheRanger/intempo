import { describe, expect, it } from 'vitest';

import { describeProblemMeasures, readingNotesFor } from './reading';
import type { MeasureConcern, ScoreJson } from '../../data/types';

const score = (notes: { pitch: string; duration: string; tied?: boolean }[]): ScoreJson =>
  ({
    time_signature: '4/4',
    key_signature: 'C major',
    tempo_marking: null,
    bpm_hint: null,
    clef: 'bass',
    repeats: [],
    ocr_confidence: 0.9,
    notes_to_human: '',
    measures: [
      {
        measure_number: 1,
        slurs: [],
        notes: notes.map((n) => ({
          pitch: n.pitch,
          duration: n.duration,
          tied_to_next: n.tied ?? false,
        })),
      },
    ],
  }) as ScoreJson;

const FOUR_QUARTERS = [
  { pitch: 'E2', duration: 'quarter', tied: true },
  { pitch: 'G2', duration: 'quarter' },
  { pitch: 'E2', duration: 'quarter' },
  { pitch: 'E2', duration: 'quarter' },
];

const tieConcern: MeasureConcern = {
  measure_number: 1,
  kind: 'tie',
  detail: 'measure 1: E2 is tied to G2 — a tie joins one pitch to itself, so this is a slur or a misread',
};

describe('which bars the app shows as needing a look', () => {
  it('shows a fault the local beat check cannot see', () => {
    // The bug: a slur written as a tie sums to exactly 4.0, so the local
    // check found nothing and the musician was never told — and had no way to
    // reach the editor for it.
    const s = score(FOUR_QUARTERS);
    expect(readingNotesFor(s).problemMeasures).toEqual([]);
    expect(readingNotesFor(s, [tieConcern]).problemMeasures).toEqual([1]);
  });

  it('falls back to the local check when the server said nothing', () => {
    // An older backend sends no field at all. A short bar is still a short bar.
    const short = score([{ pitch: 'E2', duration: 'quarter' }]);
    expect(readingNotesFor(short).problemMeasures).toEqual([1]);
  });

  it('trusts an explicit empty list over the local check', () => {
    // Not the same as absent: the server looked and found nothing.
    const short = score([{ pitch: 'E2', duration: 'quarter' }]);
    expect(readingNotesFor(short, []).problemMeasures).toEqual([]);
  });
});

describe('what the caveat line claims', () => {
  it('still says the arithmetic wording for a beat fault', () => {
    const line = describeProblemMeasures([3], {
      concerns: [{ measure_number: 3, kind: 'beats', detail: 'measure 3: 5 beats, expected 4 (long)' }],
    });
    expect(line).toContain("add up to the time signature");
  });

  it('does not claim arithmetic for a fault that is not arithmetic', () => {
    // These bars add up exactly. Saying they do not is a falsehood about the
    // musician's score.
    const line = describeProblemMeasures([1], { concerns: [tieConcern] });
    expect(line).not.toContain('add up');
    expect(line).toContain('tie joins one pitch to itself');
    expect(line?.startsWith('Measure 1')).toBe(true);
  });

  it('leads with one reason when several bars are flagged', () => {
    const line = describeProblemMeasures([1, 2], {
      concerns: [tieConcern, { ...tieConcern, measure_number: 2 }],
    });
    expect(line).toContain('2 bars need a second look');
  });

  it('drops the advice once the photograph is gone', () => {
    const line = describeProblemMeasures([1], { concerns: [tieConcern], canCheck: false });
    expect(line).not.toContain('against your copy');
  });

  it('says nothing when there is nothing to say', () => {
    expect(describeProblemMeasures([], { concerns: [] })).toBeNull();
  });
});
