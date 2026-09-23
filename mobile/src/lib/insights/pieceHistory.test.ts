import { describe, expect, it } from 'vitest';

import { historyLabel, practiceSince, takeCountLabel } from './pieceHistory';

/**
 * The piece screen's claims about a piece's past.
 *
 * Each of these is a sentence a musician reads while deciding whether to play
 * the thing again, so the failure that matters is overclaiming: a start date
 * that is really a page boundary.
 */
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
