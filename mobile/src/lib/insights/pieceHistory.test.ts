import { describe, expect, it } from 'vitest';

import { historyCount } from './pieceHistory';

/**
 * The piece screen's claims about a piece's past.
 *
 * Each of these is a sentence a musician reads while deciding whether to play
 * the thing again, so the failure that matters is overclaiming: a start date
 * that is really a page boundary.
 */
describe('historyCount', () => {
  it('is the count and the start, beside a heading that already says takes', () => {
    expect(historyCount({ takes: 14, since: '2026-09-13T12:00:00Z', recent: [] })).toMatch(
      /^14 since \S/,
    );
  });

  it('is the count alone when the start is unknown or unreadable', () => {
    expect(historyCount({ takes: 200, since: null, recent: [] })).toBe('200');
    expect(historyCount({ takes: 3, since: 'not a date', recent: [] })).toBe('3');
  });

  it('says nothing about a piece nobody has recorded', () => {
    expect(historyCount({ takes: 0, since: null, recent: [] })).toBeNull();
  });
});
