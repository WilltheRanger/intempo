import { describe, expect, it } from 'vitest';

import type { Piece } from '../data/types';
import { groupByRecency, searchLibrary } from './library';

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


/**
 * Searching the repertoire.
 *
 * These are the three defects the rule shipped with, measured against it
 * before it moved out of `LibraryScreen.tsx`: `bach suite` found nothing,
 * `allemande` found nothing, and the careful accent-stripping was not reaching
 * the field with the most accents in it.
 */
describe('searching the library', () => {
  function named(title: string, composer: string | null, movement: string | null): Piece {
    return {
      id: title + (movement ?? ''),
      title,
      composer,
      movement,
      lastPracticedAt: null,
      thumbnail: null,
      markedBpm: null,
      score: null,
    } as unknown as Piece;
  }

  const REPERTOIRE = [
    named('Suite No. 1 in G major', 'J. S. Bach', 'I. Prélude'),
    named('Suite No. 1 in G major', 'J. S. Bach', 'II. Allemande'),
    named('Études, Op. 10', 'Frédéric Chopin', null),
    named('Concerto in E minor', 'Saint-Saëns', null),
  ];

  const titles = (query: string) =>
    searchLibrary(REPERTOIRE, query).map((p) => `${p.title}${p.movement ? ` — ${p.movement}` : ''}`);

  it('finds a piece by two words from different fields', () => {
    // **The defect that mattered most.** Matched whole against title *or*
    // composer, `bach suite` returned nothing — for a library that plainly
    // contains Bach's suites. It looked like an empty library.
    expect(titles('bach suite')).toHaveLength(2);
  });

  it('does not care what order the words come in', () => {
    expect(titles('suite bach')).toEqual(titles('bach suite'));
  });

  it('finds a movement, which the row shows and the search ignored', () => {
    // Six cello suites are six rows named Prélude, Allemande, Courante. A
    // musician working on one of them types its name.
    expect(titles('allemande')).toEqual(['Suite No. 1 in G major — II. Allemande']);
  });

  it('strips accents in the movement too, not only the title', () => {
    // The accent-stripping was the one part of the old rule that was done with
    // care, and it was not reaching the field with the most accents in it.
    expect(titles('prelude')).toEqual(['Suite No. 1 in G major — I. Prélude']);
  });

  it('still strips accents in title and composer', () => {
    expect(titles('etudes')).toEqual(['Études, Op. 10']);
    expect(titles('saint-saens')).toEqual(['Concerto in E minor']);
  });

  it('is case-insensitive', () => {
    expect(titles('BACH')).toHaveLength(2);
  });

  it('narrows rather than widens as words are added', () => {
    // Terms are ANDed. A second word that matches nothing must not bring back
    // the results of the first.
    expect(titles('bach')).toHaveLength(2);
    expect(titles('bach allemande')).toHaveLength(1);
    expect(titles('bach gigue')).toEqual([]);
  });

  it('ignores the spaces around and between the words', () => {
    expect(titles('   bach    suite   ')).toHaveLength(2);
  });

  it('hands back the very same array for an empty search', () => {
    // **`toBe`, not `toEqual`, and the difference is the whole test.** With
    // `toEqual` this passed with the early return deleted — `[].every(...)` is
    // `true`, so an empty query already keeps every piece and `filter` returns
    // a copy that compares equal. The copy is the problem: the field is empty
    // for most of the life of the screen, and a fresh array on every render is
    // a fresh `groupByRecency` and a re-rendered list behind it.
    expect(searchLibrary(REPERTOIRE, '')).toBe(REPERTOIRE);
    expect(searchLibrary(REPERTOIRE, '   ')).toBe(REPERTOIRE);
  });

  it('keeps the order it was given, so the grouping still decides it', () => {
    // `groupByRecency` runs on the result. A search that reordered would
    // reorder the groups underneath it.
    expect(searchLibrary(REPERTOIRE, 'a').map((p) => p.id)).toEqual(
      REPERTOIRE.filter((p) => searchLibrary([p], 'a').length > 0).map((p) => p.id),
    );
  });

  it('survives a piece with no composer and no movement', () => {
    // Both are nullable — music in one movement has no movement, and a
    // hand-entered piece may have no composer.
    const anonymous = [named('Warm-up', null, null)];
    expect(searchLibrary(anonymous, 'warm')).toHaveLength(1);
    expect(searchLibrary(anonymous, 'bach')).toEqual([]);
  });
});
