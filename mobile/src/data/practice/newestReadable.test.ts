import { describe, expect, it } from 'vitest';

import { newestReadable } from './newestReadable';

/**
 * Paging for the newest takes that can be shown.
 *
 * Every test drives a fake page fetcher that records what it was asked for,
 * because the requests are the subject: the code this replaces asked for two
 * hundred rows carrying their full per-note analysis to render one verdict.
 */

/** A row is readable when its id does not start with `bad`. */
function readable(row: { id: string }): { id: string } | null {
  return row.id.startsWith('bad') ? null : row;
}

/** A library of `n` rows, newest first, with `bad` at the given positions. */
function library(n: number, unreadableAt: number[] = []) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `${unreadableAt.includes(i) ? 'bad' : 'take'}-${i}`,
  }));
  const asked: Array<{ offset: number; limit: number }> = [];
  return {
    asked,
    rows,
    fetchPage: async (offset: number, limit: number) => {
      asked.push({ offset, limit });
      return rows.slice(offset, offset + limit);
    },
  };
}

describe('the ordinary case', () => {
  it('makes one request and stops', async () => {
    // The whole point. One verdict on Today used to cost two hundred rows.
    const lib = library(500);

    const found = await newestReadable(lib.fetchPage, readable, 1);

    expect(found.map((f) => f.result.id)).toEqual(['take-0']);
    expect(lib.asked).toHaveLength(1);
  });

  it('asks for more rows than it needs, because some will not be readable', async () => {
    const lib = library(500);

    await newestReadable(lib.fetchPage, readable, 3);

    // A request for exactly enough only works if every row is readable, which
    // is the assumption this module exists because it cannot make.
    expect(lib.asked[0].limit).toBeGreaterThan(3);
  });

  it('keeps the order it was given', async () => {
    const lib = library(20);

    const found = await newestReadable(lib.fetchPage, readable, 3);

    expect(found.map((f) => f.result.id)).toEqual(['take-0', 'take-1', 'take-2']);
  });
});

describe('when the newest takes cannot be read', () => {
  it('goes to the next page rather than giving up', async () => {
    // The `×3` fudge it replaces did give up: it asked for three times as many
    // rows as it wanted and returned however few of those happened to be
    // readable, silently short.
    const lib = library(50, Array.from({ length: 10 }, (_, i) => i));

    const found = await newestReadable(lib.fetchPage, readable, 2, { pageSize: 5 });

    expect(found.map((f) => f.result.id)).toEqual(['take-10', 'take-11']);
    expect(lib.asked.map((a) => a.offset)).toEqual([0, 5, 10]);
  });

  it('walks pages without repeating a row or skipping one', async () => {
    const lib = library(12, [0, 1, 2, 3, 4, 5, 6, 7, 8]);

    const found = await newestReadable(lib.fetchPage, readable, 3, { pageSize: 4 });

    expect(found.map((f) => f.result.id)).toEqual(['take-9', 'take-10', 'take-11']);
  });
});

describe('the ceiling', () => {
  it('stops after maxRows instead of reading the whole library', async () => {
    // Without this, a library whose every take is unreadable would be paged to
    // the end on every screen open — which is the failure the single big call
    // avoided only by accident, and this keeps on purpose.
    const lib = library(1000, Array.from({ length: 1000 }, (_, i) => i));

    const found = await newestReadable(lib.fetchPage, readable, 1, {
      pageSize: 10,
      maxRows: 30,
    });

    expect(found).toEqual([]);
    expect(lib.asked).toHaveLength(3);
    expect(lib.asked.reduce((n, a) => n + a.limit, 0)).toBe(30);
  });

  it('never asks for a row it is not allowed to look at', async () => {
    // Paying for rows and discarding them is the cost this module exists to
    // avoid; doing it on the last page would be doing it on purpose.
    const lib = library(1000, Array.from({ length: 1000 }, (_, i) => i));

    await newestReadable(lib.fetchPage, readable, 1, { pageSize: 8, maxRows: 20 });

    expect(lib.asked.map((a) => a.limit)).toEqual([8, 8, 4]);
  });
});

describe('the end of the list', () => {
  it('stops on a short page instead of asking again', async () => {
    const lib = library(7, [0, 1, 2, 3, 4, 5, 6]);

    const found = await newestReadable(lib.fetchPage, readable, 1, { pageSize: 10 });

    expect(found).toEqual([]);
    // A short page is the end. A second request would be for a page already
    // known to be empty.
    expect(lib.asked).toHaveLength(1);
  });

  it('returns fewer than asked for rather than pretending', async () => {
    const lib = library(2);

    const found = await newestReadable(lib.fetchPage, readable, 5, { pageSize: 5 });

    expect(found.map((f) => f.result.id)).toEqual(['take-0', 'take-1']);
  });

  it('asks for nothing at all when nothing is wanted', async () => {
    const lib = library(50);

    expect(await newestReadable(lib.fetchPage, readable, 0)).toEqual([]);
    expect(lib.asked).toEqual([]);
  });
});
