import { describe, expect, it } from 'vitest';

import type { TakeResult } from '../../data/types';
import { historyLabel, lastTakeCue, practiceSince, takeCountLabel } from './pieceHistory';

/**
 * The piece screen's claims about a piece's past.
 *
 * Each of these is a sentence a musician reads while deciding whether to play
 * the thing again, so the failure that matters is overclaiming: a start date
 * that is really a page boundary, or a verdict about a take that never
 * produced one.
 */
const take = (over: Partial<TakeResult>): TakeResult =>
  ({
    id: 'take',
    pieceId: 'piece',
    status: 'ok',
    failure: null,
    headline: 'You held the tempo.',
    measures: [],
    trend: [],
    ...over,
  }) as TakeResult;

describe('takeCountLabel', () => {
  it('reads as English at one', () => {
    expect(takeCountLabel(1)).toBe('1 take');
    expect(takeCountLabel(12)).toBe('12 takes');
  });
});

describe('practiceSince', () => {
  it('names the month a piece was started', () => {
    expect(practiceSince('2026-03-03T09:00:00Z')).toMatch(/^since /);
  });

  /**
   * Null is the source saying the count hit the page ceiling, so the oldest
   * row it saw is not the oldest there is. "Since March" about a piece played
   * since January is a wrong fact rather than a missing one.
   */
  it('says nothing when the start is not known to be the start', () => {
    expect(practiceSince(null)).toBeNull();
  });

  it('refuses a date it cannot read', () => {
    expect(practiceSince('the third of never')).toBeNull();
  });
});

describe('historyLabel', () => {
  it('joins the count and the start', () => {
    expect(historyLabel({ takes: 12, since: '2026-03-03T09:00:00Z', recent: [] })).toMatch(
      /^12 takes since /,
    );
  });

  it('gives the count alone when the start is unknown', () => {
    expect(historyLabel({ takes: 200, since: null, recent: [] })).toBe('200 takes');
  });

  it('says nothing about a piece nobody has recorded', () => {
    expect(historyLabel({ takes: 0, since: null, recent: [] })).toBeNull();
  });
});

describe('lastTakeCue', () => {
  it('carries the pipeline’s own sentence, and the take it came from', () => {
    expect(lastTakeCue([take({ id: 'newest', headline: 'You rushed the opening.' })])).toEqual({
      headline: 'You rushed the opening.',
      takeId: 'newest',
    });
  });

  /**
   * A failed run's every field below `failure` is a placeholder, so its
   * headline describes nothing that was played.
   */
  it('skips a run that failed', () => {
    const cue = lastTakeCue([
      take({ id: 'broken', failure: { recoverable: true, reason: null } }),
      take({ id: 'good', headline: 'You held the tempo.' }),
    ]);
    expect(cue?.takeId).toBe('good');
  });

  /**
   * "Your recording is completely silent" is not something to work on next
   * time; it is something that already went wrong, and the verdict screen
   * says so in its own words.
   */
  it('skips a take the pipeline could not use', () => {
    const cue = lastTakeCue([
      take({ id: 'silent', status: 'no_onsets', headline: 'Completely silent.' }),
      take({ id: 'good' }),
    ]);
    expect(cue?.takeId).toBe('good');
  });

  it('says nothing when no take produced a verdict', () => {
    expect(lastTakeCue([])).toBeNull();
    expect(lastTakeCue([take({ status: 'alignment_failed' })])).toBeNull();
  });
});
