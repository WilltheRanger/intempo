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

/**
 * A score of two bars, so a test can put a short bar somewhere other than first.
 *
 * The single-bar `score` above cannot express "a short bar that is not the
 * opening", which is the whole of the pickup rule.
 */
const twoBars = (
  first: { pitch: string; duration: string; tied?: boolean }[],
  second: { pitch: string; duration: string; tied?: boolean }[],
): ScoreJson => {
  const one = score(first);
  return {
    ...one,
    measures: [
      one.measures[0],
      { ...score(second).measures[0], measure_number: 2 },
    ],
  };
};

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
    //
    // **The short bar has to be bar 2.** A short *first* measure is a pickup,
    // which the server has always forgiven and the app now does too, so the
    // one-measure score this used to build stopped being an example of a
    // fault. Example moved, assertion unchanged.
    const short = twoBars(FOUR_QUARTERS, [{ pitch: 'E2', duration: 'quarter' }]);
    expect(readingNotesFor(short).problemMeasures).toEqual([2]);
  });

  it('trusts an explicit empty list over the local check', () => {
    // Not the same as absent: the server looked and found nothing.
    const short = twoBars(FOUR_QUARTERS, [{ pitch: 'E2', duration: 'quarter' }]);
    expect(readingNotesFor(short, []).problemMeasures).toEqual([]);
  });

  it('forgives a short opening bar, because that is an anacrusis', () => {
    // Nearly every hymn, most dances and most études start on an upbeat. The
    // server has always called this `pickup`; the local fallback called it a
    // fault, so the app contradicted the server the moment it counted for
    // itself — and offered a fix for a bar that was already right.
    const pickup = twoBars([{ pitch: 'E2', duration: 'quarter' }], FOUR_QUARTERS);
    expect(readingNotesFor(pickup).problemMeasures).toEqual([]);
  });

  it('does not forgive a short bar anywhere but the opening', () => {
    const short = twoBars(FOUR_QUARTERS, [{ pitch: 'E2', duration: 'quarter' }]);
    expect(readingNotesFor(short).problemMeasures).toEqual([2]);
  });

  it('does not forgive an opening bar that is empty', () => {
    // `validate.py` calls a bar with no notes `empty`, which is a fault, and
    // checks that before the pickup branch. A first bar nothing was read out of
    // is a page whose opening was not read, not a page that starts on an upbeat.
    const empty = twoBars([], FOUR_QUARTERS);
    expect(readingNotesFor(empty).problemMeasures).toEqual([1]);
  });

  it('does not forgive an opening bar that is too long', () => {
    // The server's rule is `actual < expected`. A first bar with five beats in
    // it is a misreading whatever comes after it.
    const long = twoBars(
      [...FOUR_QUARTERS, { pitch: 'E2', duration: 'quarter' }],
      FOUR_QUARTERS,
    );
    expect(readingNotesFor(long).problemMeasures).toEqual([1]);
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
