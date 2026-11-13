import { describe, expect, it } from 'vitest';

import type { UsageResponse } from '../data/types';
import {
  analysisLimitReached,
  describeAnalysisCost,
  describeFreeTakesLeft,
  describeLastFreeAnalysis,
  describeReachedAnalysisLimit,
  nextFreeTake,
  usedThisMonth,
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
    // The claim, not the sentence. This line sits under the record button on
    // a screen a musician reads with an instrument up, so its wording is
    // expected to get shorter over time; what must not change is that the
    // last free take is the one it speaks on, and that it says so.
    expect(describeLastFreeAnalysis(usage())).toBe('1 free take left this month');
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
});

describe('whenAnalysisAllowanceResets', () => {
  it('falls back rather than printing an unparseable date', () => {
    expect(whenAnalysisAllowanceResets('not a date')).toBe('next month');
    expect(whenAnalysisAllowanceResets(null)).toBe('next month');
    expect(whenAnalysisAllowanceResets(undefined)).toBe('next month');
  });

  it('writes the day in the app\'s English, whatever the device\'s locale', () => {
    // Midday UTC, so the day is the 15th in any timezone a runner is in.
    expect(whenAnalysisAllowanceResets('2026-10-15T12:00:00Z')).toBe('on October 15');
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
    ).toContain("You've used your free take this month.");
  });

  it('counts in the plural otherwise', () => {
    expect(describeReachedAnalysisLimit(usage({ used: 3, remaining: 0 }))).toContain(
      "You've used all 3 of your free takes this month.",
    );
  });

  it('names what still works, since the app is not only the analysis', () => {
    expect(describeReachedAnalysisLimit(usage({ used: 3, remaining: 0 }))).toContain(
      'You can still record and listen back.',
    );
  });

  it('says it is the next free take that waits, not recording (the owner, 2026-11-12)', () => {
    const line = describeReachedAnalysisLimit(usage({ used: 3, remaining: 0 })) ?? '';
    expect(line).toMatch(/Your next free take is on \w+ 1\.$/);
    expect(line).not.toMatch(/Recording returns|record again on/i);
  });

  it('uses one name for the allowance, the one Record uses', () => {
    // "free analyses" here, "free take" on Record and "Analyses" on Profile
    // were one allowance under three names (the UI review, 2026-11-12).
    const lines = [
      describeReachedAnalysisLimit(usage({ used: 3, remaining: 0 })),
      describeAnalysisCost(usage({ used: 0, remaining: 3 })),
      describeLastFreeAnalysis(usage()),
    ];
    for (const line of lines) {
      expect(line).toMatch(/free takes?/);
      expect(line).not.toMatch(/analys[ie]s/i);
    }
  });

  it('says nothing while there is allowance left', () => {
    expect(describeReachedAnalysisLimit(usage())).toBeNull();
  });
});

describe('describeAnalysisCost', () => {
  it('says what sending costs, in the allowance the account has', () => {
    expect(describeAnalysisCost(usage({ used: 0, remaining: 3 }))).toBe(
      'This uses one of your 3 free takes this month.',
    );
  });

  it('names the last one as the last one', () => {
    expect(describeAnalysisCost(usage())).toBe('1 free take left this month');
  });

  it('leaves a spent allowance to the refusal', () => {
    expect(describeAnalysisCost(usage({ used: 3, remaining: 0 }))).toBeNull();
  });

  it('says nothing on an unlimited plan or with no account read yet', () => {
    expect(describeAnalysisCost(usage({ limit: null, remaining: null }))).toBeNull();
    expect(describeAnalysisCost(null)).toBeNull();
  });

  it('does not pluralise a single free analysis', () => {
    expect(describeAnalysisCost(usage({ used: 0, limit: 1, remaining: 1 }))).toBe(
      '1 free take left this month',
    );
  });
});

describe('usedThisMonth', () => {
  it('names the free limit when the server sent one', () => {
    expect(usedThisMonth(3, 3)).toBe('all 3 of your free takes');
    expect(usedThisMonth(1, 1)).toBe('your free take');
  });

  it('counts what was used otherwise, one in the singular', () => {
    expect(usedThisMonth(1, null)).toBe('1 free take');
    expect(usedThisMonth(4, null)).toBe('4 free takes');
  });
});

describe('nextFreeTake', () => {
  it('says the reset as what it gives back', () => {
    expect(nextFreeTake('2026-10-15T12:00:00Z')).toBe('Your next free take is on October 15.');
    expect(nextFreeTake(null)).toBe('Your next free take is next month.');
  });
});

describe('describeFreeTakesLeft', () => {
  it('counts what is left, as Record does', () => {
    expect(describeFreeTakesLeft(usage({ used: 1, remaining: 2 }))).toBe('2 left this month');
    expect(describeFreeTakesLeft(usage({ used: 3, remaining: 0 }))).toBe('None left this month');
  });

  it('works out what is left when the server sent only the count used', () => {
    expect(describeFreeTakesLeft(usage({ used: 1, remaining: null }))).toBe('2 left this month');
    expect(describeFreeTakesLeft(usage({ used: 5, remaining: null }))).toBe('None left this month');
  });

  it('says nothing for an unlimited plan or an unreported count', () => {
    expect(describeFreeTakesLeft(usage({ limit: null, remaining: null }))).toBeNull();
    expect(describeFreeTakesLeft(null)).toBeNull();
  });
});
