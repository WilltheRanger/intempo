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
    expect(message).toContain('Recording returns');
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

describe('the recording screen enforces the pre-flight answer', () => {
  const source = recordScreen;

  it('checks the allowance before opening the microphone', () => {
    expect(source.indexOf('if (limitMessage)')).toBeGreaterThan(-1);
    expect(source.indexOf('if (limitMessage)')).toBeLessThan(
      source.indexOf('const started = await startRecording()'),
    );
  });

  it('disables the idle record control and refreshes usage after success', () => {
    expect(source).toContain(
      'disabled={!recording && Boolean(limitMessage)}',
    );
    expect(source).toContain(
      'invalidateQueries({ queryKey: meKeys.all })',
    );
  });
});
