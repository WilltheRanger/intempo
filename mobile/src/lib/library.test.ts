import { describe, expect, it } from 'vitest';

import type { Piece } from '../data/types';
import { groupByRecency } from './library';

/**
 * The library's grouping, which had no tests — and whose headings are the
 * answer to the question a library is opened to ask.
 */

const NOW = new Date('2026-09-02T20:00:00Z');

function piece(id: string, title: string, lastPracticedAt: string | null): Piece {
  return {
    id, title, composer: 'Anon.', movement: null, lastPracticedAt,
    thumbnail: null, markedBpm: null, score: null,
  } as unknown as Piece;
}

/** `groupByRecency` output flattened to `[label, ...titles]` per group. */
function shape(pieces: Piece[]) {
  return groupByRecency(pieces, NOW).map((g) => [g.label, ...g.pieces.map((p) => p.title)]);
}

describe('groupByRecency', () => {
  it('puts each piece under the heading its own row label agrees with', () => {
    // 6 days is inside the week, 7 is not; 27 is inside the month, 28 is not.
    // The boundaries matter because the heading and the row's label are read
    // off the same function — a row saying "5 days" under "Earlier this month"
    // is the thing this module exists to prevent.
    const groups = shape([
      piece('a', 'Six days', '2026-08-27T20:00:00Z'),
      piece('b', 'Twenty days', '2026-08-13T20:00:00Z'),
      piece('c', 'Ninety days', '2026-06-04T20:00:00Z'),
      piece('d', 'Never', null),
    ]);

    expect(groups).toEqual([
      ['This week', 'Six days'],
      ['Earlier this month', 'Twenty days'],
      ['Longer ago', 'Ninety days'],
      ['Not practiced yet', 'Never'],
    ]);
  });

  it('drops a group with nothing in it rather than showing an empty heading', () => {
    expect(shape([piece('a', 'Only', null)])).toEqual([['Not practiced yet', 'Only']]);
    expect(groupByRecency([], NOW)).toEqual([]);
  });

  it('keeps the group order fixed as pieces move between them', () => {
    const labels = shape([
      piece('d', 'Never', null),
      piece('c', 'Ninety days', '2026-06-04T20:00:00Z'),
      piece('a', 'Six days', '2026-08-27T20:00:00Z'),
    ]).map(([label]) => label);

    expect(labels).toEqual(['This week', 'Longer ago', 'Not practiced yet']);
  });

  it('orders a group most recently practiced first', () => {
    expect(
      shape([
        piece('a', 'Older', '2026-08-29T09:00:00Z'),
        piece('b', 'Newer', '2026-09-01T09:00:00Z'),
      ]),
    ).toEqual([['This week', 'Newer', 'Older']]);
  });

  /**
   * **A morning's practice used to come back in server order.**
   *
   * The comparator was `daysSincePracticed(a) - daysSincePracticed(b)`, whole
   * calendar days — so three pieces worked in one session all compared equal
   * and `sort`, being stable, left them in whatever order the list arrived in,
   * under a heading claiming to be about recency.
   */
  it('orders pieces practised on one day by when, not by row order', () => {
    const morning = piece('m', 'Zebra study', '2026-09-01T09:00:00Z');
    const evening = piece('e', 'Alpha study', '2026-09-01T21:00:00Z');

    expect(shape([morning, evening])).toEqual([['This week', 'Alpha study', 'Zebra study']]);
    expect(shape([evening, morning])).toEqual([['This week', 'Alpha study', 'Zebra study']]);
  });

  it('is stable by title when two takes land at the same instant', () => {
    const a = piece('a', 'Zebra', '2026-09-01T09:00:00Z');
    const b = piece('b', 'Alpha', '2026-09-01T09:00:00Z');

    expect(shape([a, b])).toEqual(shape([b, a]));
    expect(shape([a, b])[0]).toEqual(['This week', 'Alpha', 'Zebra']);
  });

  it('sorts the never-practised alphabetically, having no recency to use', () => {
    expect(
      shape([piece('a', 'Zebra', null), piece('b', 'Alpha', null)]),
    ).toEqual([['Not practiced yet', 'Alpha', 'Zebra']]);
  });

  it('treats an unreadable timestamp as never practised rather than as today', () => {
    // `daysSincePracticed` returns null for one, and the alternative — falling
    // through to a bucket — would file a piece nobody has played under "This
    // week".
    expect(shape([piece('a', 'Broken', 'not a date')])).toEqual([
      ['Not practiced yet', 'Broken'],
    ]);
  });
});
