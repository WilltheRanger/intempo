import { describe, expect, it } from 'vitest';

import type { TakeResult } from '../../data/types';
import { historyCount, lastTakeLine } from './pieceHistory';

/**
 * The piece screen's claims about a piece's past.
 *
 * Each of these is a sentence a musician reads while deciding whether to play
 * the thing again, so the failure that matters is overclaiming: a start date
 * that is really a page boundary.
 */
describe('historyCount', () => {
  it('is the count and the start, beside a heading that already says takes', () => {
    // Midday UTC, so the day is the 13th in any timezone a runner is in.
    expect(historyCount({ takes: 14, since: '2026-09-13T12:00:00Z', recent: [] })).toBe(
      '14 since Sep 13',
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

describe('lastTakeLine', () => {
  const now = new Date(2026, 10, 12, 20, 0);
  const daysAgo = (days: number) => new Date(2026, 10, 12 - days, 9, 0).toISOString();
  const rushed = {
    failure: null,
    status: 'ok',
    direction: 'rush',
    lowConfidence: false,
    recordedAt: daysAgo(3),
    measures: [
      { measure: 1, band: 'on', direction: 'on' },
      { measure: 2, band: 'rush_drag', direction: 'rush' },
      { measure: 3, band: 'on', direction: 'on' },
    ],
  } as unknown as TakeResult;

  it('is how the newest take went, and when, in the takes page’s words', () => {
    expect(lastTakeLine({ takes: 7, since: daysAgo(18), recent: [rushed] }, now)).toBe(
      'Rushed in the middle · 3 days ago',
    );
  });

  it('says a take that gave no verdict the way its row does', () => {
    const silent = { ...rushed, status: 'not_played', recordedAt: daysAgo(0) } as TakeResult;
    expect(lastTakeLine({ takes: 2, since: daysAgo(4), recent: [silent] }, now)).toBe(
      'We didn’t hear you play · Today',
    );
  });

  it('falls back to the count when the newest take is not in hand', () => {
    expect(
      lastTakeLine({ takes: 14, since: '2026-09-13T12:00:00Z', recent: [] }, now),
    ).toBe('14 since Sep 13');
  });

  it('says nothing about a piece nobody has recorded', () => {
    expect(lastTakeLine({ takes: 0, since: null, recent: [] }, now)).toBeNull();
  });
});
