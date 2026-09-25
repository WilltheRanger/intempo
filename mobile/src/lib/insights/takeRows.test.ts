import { describe, expect, it } from 'vitest';

import type { TakeResult } from '../../data/types';
import { moreTakesLabel, takeRowWords } from './takeRows';

function take(over: Partial<TakeResult>): TakeResult {
  return {
    failure: null,
    status: 'ok',
    headline: 'Bars 13–25 went at 81.',
    ...over,
  } as TakeResult;
}

describe('takeRowWords', () => {
  it('is the verdict’s own sentence, as a label', () => {
    expect(takeRowWords(take({}))).toBe('Bars 13–25 went at 81');
  });

  it('is the heading of a take that gave no verdict', () => {
    expect(takeRowWords(take({ status: 'not_played' }))).toBe('We didn’t hear you play');
  });

  it('is what went wrong with a run that failed', () => {
    expect(
      takeRowWords(take({ failure: { recoverable: true, reason: null } })),
    ).toBe('Something went wrong on our end');
    expect(
      takeRowWords(take({ failure: { recoverable: false, reason: 'audio_too_long' } })),
    ).toBe('That recording is too long');
  });
});

describe('moreTakesLabel', () => {
  it('says all only when all are loaded', () => {
    expect(moreTakesLabel(11, 11)).toBe('See all 11');
    expect(moreTakesLabel(40, 12)).toBe('See the last 12');
  });

  it('is nothing when the rows already show every take loaded', () => {
    expect(moreTakesLabel(3, 3)).toBeNull();
    expect(moreTakesLabel(9, 2)).toBeNull();
  });
});
