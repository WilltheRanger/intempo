import { describe, expect, it } from 'vitest';

import { failureTitle, nothingUsableTitle } from './failureTitle';

/**
 * The one line a musician reads first on a take that produced no verdict.
 *
 * Four outcomes shared two headings and one of them covered three, so the
 * heading named the app's process rather than the finding. These pin that each
 * one says something different and that none of them describes the playing.
 */
describe('failureTitle', () => {
  it('owns a failure that was ours', () => {
    expect(failureTitle({ recoverable: true, reason: 'internal_error' })).toBe(
      'Something went wrong on our end',
    );
  });

  it('says what happened when it will not come back', () => {
    expect(
      failureTitle({ recoverable: false, reason: 'audio_unavailable' }),
    ).toBe('This recording couldn’t be processed');
  });

  it('never blames the playing', () => {
    for (const recoverable of [true, false]) {
      expect(failureTitle({ recoverable, reason: null })).not.toMatch(
        /\byou(r)?\b/i,
      );
    }
  });
});

describe('nothingUsableTitle', () => {
  /**
   * `diagnostics.py` is careful that silence is "nothing" rather than "quiet",
   * because a musician who played loudly needs to know this is a routing fault.
   * The heading must not paraphrase that into the other.
   */
  it('says nothing arrived, not that it was quiet', () => {
    expect(nothingUsableTitle('no_onsets')).toBe('Nothing reached the microphone');
    expect(nothingUsableTitle('no_onsets')).not.toMatch(/quiet|soft|faint/i);
  });

  it('says a take it could not follow did not line up', () => {
    expect(nothingUsableTitle('alignment_failed')).toContain('line up');
  });

  /**
   * A metronome, talking or a knock, and no instrument: the owner's heading,
   * with the pipeline's "Try again closer to your instrument." under it.
   */
  it('says it did not hear the musician play', () => {
    expect(nothingUsableTitle('not_played')).toBe('We didn’t hear you play');
  });

  /** Every outcome its own heading. Sharing one was the fault this replaced. */
  it('gives every status a different heading', () => {
    const titles = (['no_onsets', 'alignment_failed', 'not_played'] as const).map(
      nothingUsableTitle,
    );
    expect(new Set(titles).size).toBe(titles.length);
  });
});
