import { describe, expect, it } from 'vitest';

import {
  BUDGET_CHARS,
  CACHE_SHAPE,
  READING_SHELF_LIFE_MS,
  busterFor,
  deserializeFromDisk,
  musicianForDisk,
  persistedKind,
  pieceForDisk,
  serializeForDisk,
  shouldPersist,
} from './persistCache';
import type { Musician, Piece } from '../types';

function piece(id: string, notes = 1): Piece {
  return {
    id,
    title: `Piece ${id}`,
    composer: 'Wohlfahrt',
    movement: null,
    lastPracticedAt: null,
    thumbnail: { uri: 'https://storage/x?token=abc', cacheKey: '/x' },
    pages: [{ uri: 'https://storage/x?token=abc', cacheKey: '/x' }],
    markedBpm: 72,
    score: {
      measures: Array.from({ length: notes }, (_, i) => ({
        measure_number: i + 1,
        notes: [],
      })),
    } as unknown as Piece['score'],
    concerns: [],
    transcriptionStatus: 'done',
    transcriptionStage: null,
    transcriptionError: null,
    transcriptionAccepted: true,
    pageImageDiscarded: false,
  };
}

function musician(): Musician {
  return {
    id: 'u1',
    email: 'a@example.test',
    tier: 'free',
    role: 'student',
    studioId: null,
    usage: null,
    avatarUrl: 'https://storage/avatar.jpg?token=abc',
    displayName: 'Alex',
    instrument: 'violin',
    onboarded: true,
    trainingConsent: false,
  };
}

function stored(queryKey: readonly unknown[], data: unknown, dataUpdatedAt = 0) {
  return { queryKey, state: { status: 'success', dataUpdatedAt, data } };
}

function client(queries: ReturnType<typeof stored>[]) {
  return {
    timestamp: 1,
    buster: busterFor('me'),
    clientState: { mutations: [], queries },
  };
}

describe('busterFor', () => {
  it('separates two musicians on one device', () => {
    expect(busterFor('a')).not.toBe(busterFor('b'));
  });

  it('carries the shape, so a build reading an older layout discards it', () => {
    expect(busterFor('a')).toBe(`${CACHE_SHAPE}:a`);
  });
});

describe('persistedKind', () => {
  it('names the three piece queries', () => {
    expect(persistedKind(['pieces', 'list'])).toBe('list');
    expect(persistedKind(['pieces', 'current'])).toBe('current');
    expect(persistedKind(['pieces', 'detail', 'p1'])).toBe('detail');
  });

  it('names the account and the latest readings, which every launch waits on', () => {
    expect(persistedKind(['me'])).toBe('me');
    expect(persistedKind(['insights'])).toBe('insights');
    expect(persistedKind(['takes', 'latest'])).toBe('takes');
    expect(persistedKind(['takes', 'recent', 20])).toBe('takes');
  });

  it('is an allow-list — nothing else is written to the device', () => {
    // A piece's take history grows without bound and is prefetched on the way
    // into the piece; the rest are short-lived or not queries this app makes.
    expect(persistedKind(['takes', 'history', 'p1'])).toBeNull();
    expect(persistedKind(['takes', 'latest', 'p1'])).toBeNull();
    expect(persistedKind(['takes'])).toBeNull();
    expect(persistedKind(['profile'])).toBeNull();
    expect(persistedKind(['corrections', 'a1'])).toBeNull();
  });

  it('does not match the bare root, which invalidation uses', () => {
    expect(persistedKind(['pieces'])).toBeNull();
  });
});

describe('shouldPersist', () => {
  it('keeps a successful piece query', () => {
    expect(shouldPersist(['pieces', 'list'], 'success')).toBe(true);
  });

  it('never writes a failure — a restored error is an error with no cause', () => {
    expect(shouldPersist(['pieces', 'list'], 'error')).toBe(false);
    expect(shouldPersist(['pieces', 'list'], 'pending')).toBe(false);
  });
});

describe('pieceForDisk', () => {
  it('drops the signed URLs, which are good for an hour and this is not', () => {
    const onDisk = pieceForDisk(piece('p1'), true);
    expect(onDisk.thumbnail).toBeNull();
    expect(onDisk.pages).toEqual([]);
  });

  it('keeps the notation when asked — it is the thing worth reading offline', () => {
    expect(pieceForDisk(piece('p1'), true).score).not.toBeNull();
  });

  it('drops the notation when not — the listing has never drawn a note', () => {
    expect(pieceForDisk(piece('p1'), false).score).toBeNull();
  });

  it('leaves everything a screen names untouched', () => {
    const onDisk = pieceForDisk(piece('p1'), true);
    expect(onDisk.title).toBe('Piece p1');
    expect(onDisk.composer).toBe('Wohlfahrt');
    expect(onDisk.markedBpm).toBe(72);
    expect(onDisk.transcriptionStatus).toBe('done');
  });
});

describe('serializeForDisk', () => {
  function read(json: string) {
    return JSON.parse(json) as {
      clientState: {
        mutations: unknown[];
        queries: { queryKey: unknown[]; state: { data: unknown } }[];
      };
    };
  }

  it('strips the listing of notation but keeps a piece that was opened', () => {
    const out = read(
      serializeForDisk(
        client([
          stored(['pieces', 'list'], [piece('p1'), piece('p2')]),
          stored(['pieces', 'detail', 'p1'], piece('p1')),
        ]),
      ),
    );
    const list = out.clientState.queries.find((q) => q.queryKey[1] === 'list');
    const detail = out.clientState.queries.find((q) => q.queryKey[1] === 'detail');
    expect((list?.state.data as Piece[]).every((p) => p.score === null)).toBe(true);
    expect((detail?.state.data as Piece).score).not.toBeNull();
  });

  it('writes no signed URL anywhere', () => {
    const json = serializeForDisk(
      client([
        stored(['pieces', 'list'], [piece('p1')]),
        stored(['pieces', 'current'], piece('p1')),
        stored(['pieces', 'detail', 'p1'], piece('p1')),
      ]),
    );
    expect(json).not.toContain('token=');
  });

  it('keeps a null answer — no current piece is a fact the screen renders', () => {
    const out = read(serializeForDisk(client([stored(['pieces', 'current'], null)])));
    expect(out.clientState.queries[0]?.state.data).toBeNull();
  });

  it('leaves out every query the allow-list does not name', () => {
    const out = read(
      serializeForDisk(
        client([
          stored(['takes', 'history', 'p1'], { takes: [] }),
          stored(['corrections', 'a1'], []),
          stored(['pieces', 'list'], [piece('p1')]),
        ]),
      ),
    );
    expect(out.clientState.queries).toHaveLength(1);
    expect(out.clientState.queries[0]?.queryKey).toEqual(['pieces', 'list']);
  });

  it('writes the account first, and without its signed photo URL', () => {
    const out = read(
      serializeForDisk(
        client([
          stored(['pieces', 'list'], [piece('p1')]),
          stored(['me'], musician()),
        ]),
      ),
    );
    expect(out.clientState.queries[0]?.queryKey).toEqual(['me']);
    expect(JSON.stringify(out)).not.toContain('token=');
    expect((out.clientState.queries[0]?.state.data as Musician).displayName).toBe('Alex');
  });

  it('never writes mutations, which would replay a take on a future launch', () => {
    const withMutation = {
      ...client([stored(['pieces', 'list'], [piece('p1')])]),
      clientState: {
        mutations: [{ mutationKey: ['takes'], state: {} }],
        queries: [stored(['pieces', 'list'], [piece('p1')])],
      },
    };
    expect(read(serializeForDisk(withMutation)).clientState.mutations).toEqual([]);
  });

  it('stays inside the budget', () => {
    const big = Array.from({ length: 40 }, (_, i) => stored(['pieces', 'detail', `p${i}`], piece(`p${i}`, 400)));
    const json = serializeForDisk(client([stored(['pieces', 'list'], [piece('p1')]), ...big]), 60_000);
    expect(json.length).toBeLessThanOrEqual(60_000);
    // And it is valid JSON, not a truncated string.
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('drops the pieces opened longest ago first', () => {
    const out = read(
      serializeForDisk(
        client([
          stored(['pieces', 'detail', 'old'], piece('old', 200), 1_000),
          stored(['pieces', 'detail', 'new'], piece('new', 200), 9_000),
        ]),
        // Room for the envelope and one of the two.
        JSON.stringify(client([stored(['pieces', 'detail', 'new'], pieceForDisk(piece('new', 200), true), 9_000)])).length,
      ),
    );
    expect(out.clientState.queries.map((q) => q.queryKey[2])).toEqual(['new']);
  });

  it('keeps the listing ahead of the pieces, however recently they were read', () => {
    const out = read(
      serializeForDisk(
        client([
          stored(['pieces', 'detail', 'p1'], piece('p1'), 9_000),
          stored(['pieces', 'list'], [piece('p1')], 1_000),
        ]),
      ),
    );
    expect(out.clientState.queries[0]?.queryKey).toEqual(['pieces', 'list']);
  });

  it('skips one oversized piece rather than losing the ones behind it', () => {
    const fits = stored(['pieces', 'detail', 'small'], piece('small', 1), 1_000);
    const huge = stored(['pieces', 'detail', 'huge'], piece('huge', 5_000), 9_000);
    const budget = JSON.stringify(client([fits])).length + 200;
    const out = read(serializeForDisk(client([huge, fits]), budget));
    expect(out.clientState.queries.map((q) => q.queryKey[2])).toEqual(['small']);
  });

  it('has a default budget, so a caller cannot forget one', () => {
    expect(BUDGET_CHARS).toBeGreaterThan(0);
    expect(serializeForDisk(client([stored(['pieces', 'list'], [piece('p1')])])).length).toBeLessThan(
      BUDGET_CHARS,
    );
  });
});

describe('musicianForDisk', () => {
  it('drops only the signed photo URL', () => {
    const kept = musicianForDisk(musician());
    expect(kept.avatarUrl).toBeNull();
    expect({ ...kept, avatarUrl: musician().avatarUrl }).toEqual(musician());
  });
});

describe('deserializeFromDisk', () => {
  const NOW = 10 * READING_SHELF_LIFE_MS;
  const raw = (queries: ReturnType<typeof stored>[]) => JSON.stringify(client(queries));

  it('keeps a reading from within the day', () => {
    const out = deserializeFromDisk(raw([stored(['insights'], { a: 1 }, NOW - 60_000)]), NOW);
    expect(out.clientState.queries).toHaveLength(1);
  });

  it('drops readings older than a day, whatever was last written', () => {
    // An app left closed for a week writes nothing that week, so the age has
    // to be judged on the way in.
    const old = NOW - READING_SHELF_LIFE_MS - 1;
    const out = deserializeFromDisk(
      raw([
        stored(['insights'], { a: 1 }, old),
        stored(['takes', 'recent', 20], [], old),
        stored(['me'], musician(), old),
        stored(['pieces', 'list'], [piece('p1')], old),
      ]),
      NOW,
    );
    expect(out.clientState.queries.map((q) => q.queryKey[0])).toEqual(['me', 'pieces']);
  });

  it('passes a client it cannot read through untouched', () => {
    expect(deserializeFromDisk('{"nope":1}', NOW)).toEqual({ nope: 1 });
  });
});
