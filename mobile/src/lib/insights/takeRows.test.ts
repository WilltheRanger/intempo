import { describe, expect, it } from 'vitest';

import type { TakeResult } from '../../data/types';
import {
  olderTakesNote,
  takeDateLabel,
  takeRowIsVerdict,
  takeRowTitle,
  takeRowWords,
} from './takeRows';

function take(over: Partial<TakeResult>): TakeResult {
  return {
    failure: null,
    status: 'ok',
    headline: 'Bars 13–25 went at 81.',
    ...over,
  } as TakeResult;
}

describe('takeRowWords', () => {
  it('is the verdict’s own sentence, as a label, with its unit and target', () => {
    expect(takeRowWords(take({ targetBpm: 88 }))).toBe('Bars 13–25 at 81, not 88 BPM');
  });

  it('keeps any other sentence as it is', () => {
    expect(takeRowWords(take({ headline: 'Steady all the way through.', targetBpm: 88 }))).toBe(
      'Steady all the way through',
    );
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

describe('olderTakesNote', () => {
  it('says how many of how many when not every take was fetched', () => {
    expect(olderTakesNote(40, 12)).toBe('The last 12 of 40');
  });

  it('is nothing when every take is on the page', () => {
    expect(olderTakesNote(11, 11)).toBeNull();
    expect(olderTakesNote(3, 3)).toBeNull();
  });
});

describe('takeRowIsVerdict', () => {
  it('is a take the analysis read', () => {
    expect(takeRowIsVerdict(take({}))).toBe(true);
  });

  it('is not a take it refused or could not time', () => {
    expect(takeRowIsVerdict(take({ status: 'not_played' }))).toBe(false);
    expect(takeRowIsVerdict(take({ status: 'alignment_failed' }))).toBe(false);
    expect(takeRowIsVerdict(take({ failure: { recoverable: true, reason: null } }))).toBe(false);
  });
});

describe('takeRowTitle', () => {
  it("is the take's result title without the You", () => {
    const rushed = take({
      direction: 'rush',
      lowConfidence: false,
      measures: [
        { measure: 1, band: 'on', direction: 'on' },
        { measure: 2, band: 'rush_drag', direction: 'rush' },
        { measure: 3, band: 'on', direction: 'on' },
      ] as TakeResult['measures'],
    });
    expect(takeRowTitle(rushed)).toBe('Rushed in the middle');
  });

  it('says a refusal the way the row always did', () => {
    expect(takeRowTitle(take({ status: 'not_played' }))).toBe('We didn’t hear you play');
  });
});

describe('takeDateLabel', () => {
  const now = new Date(2026, 8, 29, 20, 0);
  const at = (days: number) => new Date(2026, 8, 29 - days, 9, 0).toISOString();

  it('says the recent days in words', () => {
    expect(takeDateLabel(at(0), now)).toBe('Today');
    expect(takeDateLabel(at(1), now)).toBe('Yesterday');
    expect(takeDateLabel(at(3), now)).toBe('3 days ago');
  });

  it('dates everything older, with the year when it is not this one', () => {
    expect(takeDateLabel(at(7), now)).toBe('Sep 22');
    expect(takeDateLabel(new Date(2025, 11, 30).toISOString(), now)).toBe('Dec 30, 2025');
  });
});
