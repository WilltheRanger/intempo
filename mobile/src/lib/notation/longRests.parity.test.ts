import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { KEPT_BARS, MIN_BARS_TO_SKIP, shortenLongRests, skippableBars } from './longRests';

/**
 * The app's half of `fixtures/practice/long_rests.json`.
 *
 * `backend/app/tests/test_long_rest_parity.py` checks the server against the
 * same file. If they drift, nothing looks broken from either side: the app
 * shortens the score to play and count it, the backend judges the recording
 * against a score it shortened differently, and a musician who came in exactly
 * where the app counted them in is told they were bars early.
 */

// Imported rather than read off disk: this project has no `@types/node`, and
// the contract is a static file that Vite can resolve like any other module.
import CONTRACT from '../../../../fixtures/practice/long_rests.json';

const FIXTURE = CONTRACT as {
  min_bars: number;
  kept_bars: number;
  cases: { name: string; in: string[][]; out: string[][]; skipped_bars: number }[];
};

function scoreOf(bars: string[][]): ScoreJson {
  return {
    clef: 'bass',
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: null,
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
    measures: bars.map((durations, index) => ({
      measure_number: index + 1,
      slurs: [],
      notes: durations.map((d) => ({
        pitch: d === 'rest' ? 'rest' : 'E2',
        duration: d === 'rest' ? 'whole' : d,
        tied_to_next: false,
      })),
    })),
  } as unknown as ScoreJson;
}

const shapeOf = (score: ScoreJson) =>
  score.measures.map((m) => m.notes.map((n) => (n.pitch === 'rest' ? 'rest' : n.duration)));

describe('the contract', () => {
  it('is the same numbers on both sides', () => {
    // Written down once. Two copies of a threshold is two chances to disagree
    // about how long a rest has to be before it is skipped.
    expect(MIN_BARS_TO_SKIP).toBe(FIXTURE.min_bars);
    expect(KEPT_BARS).toBe(FIXTURE.kept_bars);
  });

  it.each(FIXTURE.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const result = shortenLongRests(scoreOf(testCase.in));

    expect(shapeOf(result.score)).toEqual(testCase.out);
    expect(result.skippedBars).toBe(testCase.skipped_bars);
  });
});

describe('what the app needs on top', () => {
  it('returns the same object when there is nothing to skip', () => {
    const score = scoreOf([['quarter'], ['quarter']]);
    expect(shortenLongRests(score).score).toBe(score);
  });

  it('keeps the surviving bar’s number and metre', () => {
    // The *first* of the run, so it carries the number a musician reads off the
    // page. Taking the last would silently move a metre change to a bar that
    // was skipped.
    const score = scoreOf([['quarter'], ['rest'], ['rest'], ['rest'], ['rest'], ['quarter']]);
    score.measures[1] = { ...score.measures[1], time_signature: '3/4' };

    const { score: shorter } = shortenLongRests(score);

    expect(shorter.measures.map((m) => m.measure_number)).toEqual([1, 2, 6]);
    expect(shorter.measures[1].time_signature).toBe('3/4');
  });

  it('counts what a skip would save without doing it', () => {
    expect(skippableBars(scoreOf([['quarter'], ['rest'], ['rest'], ['rest'], ['rest']]))).toBe(3);
    expect(skippableBars(scoreOf([['quarter'], ['rest']]))).toBe(0);
    expect(skippableBars(null)).toBe(0);
  });
});
