import { describe, expect, it } from 'vitest';

import {
  analysisLimitReached,
  describeReachedAnalysisLimit,
} from './analysisAllowance';
// Raw text rather than Node fs: this Expo project intentionally has no
// `@types/node`, and the test only needs to hold the screen to the pure rule.
import recordScreen from '../screens/record/RecordScreen.tsx?raw';

const RESET = '2026-10-01T00:00:00Z';

describe('checking the analysis allowance before a take', () => {
  it('does not block unknown or unlimited usage', () => {
    expect(analysisLimitReached(null)).toBe(false);
    expect(
      analysisLimitReached({
        used: 20,
        limit: null,
        remaining: null,
        resets_at: RESET,
      }),
    ).toBe(false);
  });

  it('allows the last remaining analysis', () => {
    expect(
      analysisLimitReached({
        used: 2,
        limit: 3,
        remaining: 1,
        resets_at: RESET,
      }),
    ).toBe(false);
  });

  it('blocks zero remaining and defensive over-limit responses', () => {
    expect(
      analysisLimitReached({
        used: 3,
        limit: 3,
        remaining: 0,
        resets_at: RESET,
      }),
    ).toBe(true);
    expect(
      analysisLimitReached({
        used: 4,
        limit: 3,
        remaining: 2,
        resets_at: RESET,
      }),
    ).toBe(true);
  });

  it('explains the limit before recording and preserves practice tools', () => {
    const message = describeReachedAnalysisLimit({
      used: 3,
      limit: 3,
      remaining: 0,
      resets_at: RESET,
    });
    expect(message).toContain('all 3 free analyses');
    // Recording stays open at the limit (the owner, 2026-11-12): it is the
    // analysis that comes back with the new month.
    expect(message).toContain('You can still record');
    expect(message).toContain('analysis comes back');
    expect(message).not.toContain('Recording returns');
    expect(message).toContain('listen to the score');
    expect(message).toContain('practise with the metronome');
  });

  it('says nothing while recording remains available', () => {
    expect(
      describeReachedAnalysisLimit({
        used: 1,
        limit: 3,
        remaining: 2,
        resets_at: RESET,
      }),
    ).toBeNull();
  });
});

describe('the recording screen at the limit', () => {
  const source = recordScreen;

  /**
   * **Recording stays open; Analyse is what waits** (the owner, 2026-11-12,
   * reversing the lock this pinned). Only Analyse spends an analysis, and the
   * record button used to lock with it, so a musician out of free analyses
   * could not record a take to hear back.
   */
  it('keeps the record control live and locks only Analyse', () => {
    expect(source).not.toContain('disabled={!recording && Boolean(limitMessage)}');
    expect(source).toContain('disabled={!takeReady || Boolean(limitMessage)}');
  });

  it('refreshes usage after a take is accepted', () => {
    expect(source).toContain('invalidateQueries({ queryKey: meKeys.all })');
  });
});
