import { describe, expect, it } from 'vitest';

import type { UsageResponse } from '../data/types';
import {
  analysisLimitReached,
  describeLastFreeAnalysis,
  describeReachedAnalysisLimit,
  whenAnalysisAllowanceResets,
} from './analysisAllowance';

/**
 * The month's allowance, and the two sentences the Record screen says about it.
 *
 * Untested until now, which is how the gap these cover survived: the app was
 * silent about a three-a-month allowance until it hit **zero**, so a musician
 * spent the last one without knowing it was the last. Assembled copy with
 * plurals in it, on the screen where the microphone is about to open.
 */
function usage(over: Partial<UsageResponse> = {}): UsageResponse {
  return {
    used: 2,
    limit: 3,
    remaining: 1,
    resets_at: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

describe('describeLastFreeAnalysis', () => {
  it('speaks on the last one', () => {
    expect(describeLastFreeAnalysis(usage())).toContain(
      'This is your last free analysis this month.',
    );
  });

  it('is silent while the count still has slack', () => {
    expect(describeLastFreeAnalysis(usage({ used: 1, remaining: 2 }))).toBeNull();
  });

  it('is silent once the allowance is gone, where the other sentence speaks', () => {
    // Both firing would put two sentences about the same allowance in one slot,
    // one of them saying a take is possible and the other that it is not.
    const spent = usage({ used: 3, remaining: 0 });
    expect(describeLastFreeAnalysis(spent)).toBeNull();
    expect(describeReachedAnalysisLimit(spent)).not.toBeNull();
  });

  it('never speaks to an account with no quota', () => {
    expect(
      describeLastFreeAnalysis({ ...usage(), limit: null, remaining: null }),
    ).toBeNull();
  });

  it('says nothing when the server reported no usage at all', () => {
    expect(describeLastFreeAnalysis(null)).toBeNull();
    expect(describeLastFreeAnalysis(undefined)).toBeNull();
  });

  it('names the date the next one arrives', () => {
    // Rendered in the reader's own zone deliberately: `resets_at` is the first
    // instant of next month, so the local calendar date of that instant is when
    // the allowance actually returns for the person reading it.
    const date = new Date('2026-10-01T00:00:00.000Z').toLocaleDateString(
      undefined,
      { day: 'numeric', month: 'long' },
    );
    expect(describeLastFreeAnalysis(usage())).toContain(`available on ${date}.`);
  });
});

describe('whenAnalysisAllowanceResets', () => {
  it('falls back rather than printing an unparseable date', () => {
    expect(whenAnalysisAllowanceResets('not a date')).toBe('next month');
    expect(whenAnalysisAllowanceResets(null)).toBe('next month');
    expect(whenAnalysisAllowanceResets(undefined)).toBe('next month');
  });
});

describe('analysisLimitReached', () => {
  it('trusts the server\'s own remaining count', () => {
    expect(analysisLimitReached(usage({ remaining: 0 }))).toBe(true);
    expect(analysisLimitReached(usage({ remaining: 1 }))).toBe(false);
  });

  it('blocks an account already over the line', () => {
    // The defensive path, for responses without `remaining`. Being over must
    // not read as less blocked than being exactly at it.
    expect(analysisLimitReached(usage({ used: 4, remaining: null }))).toBe(true);
  });

  it('never blocks an account with no quota', () => {
    expect(analysisLimitReached({ ...usage(), limit: null, remaining: null })).toBe(
      false,
    );
    expect(analysisLimitReached(null)).toBe(false);
  });
});

describe('describeReachedAnalysisLimit', () => {
  it('counts in the singular when the allowance is one', () => {
    expect(
      describeReachedAnalysisLimit({
        used: 1,
        limit: 1,
        remaining: 0,
        resets_at: '2026-10-01T00:00:00.000Z',
      }),
    ).toContain("You've used your free analysis this month.");
  });

  it('counts in the plural otherwise', () => {
    expect(describeReachedAnalysisLimit(usage({ used: 3, remaining: 0 }))).toContain(
      "You've used all 3 free analyses this month.",
    );
  });

  it('names what still works, since the app is not only the analysis', () => {
    expect(describeReachedAnalysisLimit(usage({ used: 3, remaining: 0 }))).toContain(
      'listen to the score and practise with the metronome',
    );
  });

  it('says nothing while there is allowance left', () => {
    expect(describeReachedAnalysisLimit(usage())).toBeNull();
  });
});
