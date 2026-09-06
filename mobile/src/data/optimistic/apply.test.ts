import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  beginOptimistic,
  patchEverywhere,
  removeEverywhere,
  snapshot,
} from './apply';

/**
 * Showing a tap's result before the server agrees, and taking it back if it
 * disagrees.
 *
 * Every mutation in this app used to wait — seventeen of them, none with an
 * `onMutate`. On a practice-room connection that pause is the whole
 * interaction.
 *
 * **Not applied everywhere, and the exclusions are the point.**
 * `acceptTranscription` discards the musician's photograph and `submitTake`
 * spends one of three free monthly analyses; showing either as done before the
 * server says so is a lie about something that cannot be taken back. These
 * rules are for the changes that *can* be undone, and they make undoing the
 * default.
 */

interface Row {
  id: string;
  title: string;
}

const KEY = ['pieces'];
let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([...KEY, 'list'], [
    { id: 'a', title: 'Sonata' },
    { id: 'b', title: 'Caprice' },
  ] satisfies Row[]);
  client.setQueryData([...KEY, 'detail', 'a'], { id: 'a', title: 'Sonata' } satisfies Row);
  client.setQueryData([...KEY, 'current'], { id: 'a', title: 'Sonata' } satisfies Row);
});

describe('patching a row', () => {
  it('reaches every copy of it, not just the one the screen is reading', () => {
    // A piece is in the library list, on Today, and in its own detail query.
    // Patching one and not the others is worse than patching none: the same
    // fact reads two ways on two screens.
    patchEverywhere<Row>(client, KEY, 'a', (row) => ({ ...row, title: 'Partita' }));

    expect(client.getQueryData([...KEY, 'detail', 'a'])).toMatchObject({ title: 'Partita' });
    expect(client.getQueryData([...KEY, 'current'])).toMatchObject({ title: 'Partita' });
    expect(client.getQueryData<Row[]>([...KEY, 'list'])?.[0]).toMatchObject({ title: 'Partita' });
  });

  it('leaves every other row alone', () => {
    patchEverywhere<Row>(client, KEY, 'a', (row) => ({ ...row, title: 'Partita' }));

    expect(client.getQueryData<Row[]>([...KEY, 'list'])?.[1]).toMatchObject({ title: 'Caprice' });
  });

  it('is quiet about a row that is not cached', () => {
    expect(() =>
      patchEverywhere<Row>(client, KEY, 'nope', (row) => row),
    ).not.toThrow();
  });
});

describe('removing a row', () => {
  it('drops it from every list', () => {
    removeEverywhere<Row>(client, KEY, 'a');

    expect(client.getQueryData<Row[]>([...KEY, 'list'])).toEqual([
      { id: 'b', title: 'Caprice' },
    ]);
  });

  it('nulls a detail rather than deleting the key', () => {
    // A detail query with no data renders the screen's "couldn't open this"
    // state, which is the truth once the row is gone. An absent key shows a
    // spinner for ever.
    removeEverywhere<Row>(client, KEY, 'a');

    expect(client.getQueryData([...KEY, 'detail', 'a'])).toBeNull();
  });
});

describe('taking it back', () => {
  it('restores every query exactly, including the ones it never touched', () => {
    const undo = snapshot(client, KEY);
    patchEverywhere<Row>(client, KEY, 'a', (row) => ({ ...row, title: 'Partita' }));
    removeEverywhere<Row>(client, KEY, 'b');

    undo();

    expect(client.getQueryData<Row[]>([...KEY, 'list'])).toEqual([
      { id: 'a', title: 'Sonata' },
      { id: 'b', title: 'Caprice' },
    ]);
    expect(client.getQueryData([...KEY, 'detail', 'a'])).toMatchObject({ title: 'Sonata' });
  });

  it('restores the bytes rather than applying an inverse', async () => {
    // **Why a snapshot and not an undo function.** Reversing a rename needs
    // the old name *and* the knowledge that nothing else changed it in
    // between. Two edits racing would restore the second one's value over the
    // first. Keeping the bytes sidesteps the question entirely.
    const first = await beginOptimistic(client, KEY);
    patchEverywhere<Row>(client, KEY, 'a', (row) => ({ ...row, title: 'One' }));
    patchEverywhere<Row>(client, KEY, 'a', (row) => ({ ...row, title: 'Two' }));

    first();

    expect(client.getQueryData([...KEY, 'detail', 'a'])).toMatchObject({ title: 'Sonata' });
  });
});

describe('starting an optimistic write', () => {
  it('cancels in-flight fetches before it snapshots', async () => {
    /*
     * **The ordering is the whole safety of it.** A refetch already running
     * when the tap lands resolves *after* the optimistic write and overwrites
     * it with data fetched before the change — the value flips to the new one
     * and silently back, which reads as the tap not working.
     */
    let resolveFetch: (rows: Row[]) => void = () => {};
    const slow = new Promise<Row[]>((resolve) => {
      resolveFetch = resolve;
    });
    void client.fetchQuery({ queryKey: [...KEY, 'list'], queryFn: () => slow });

    const undo = await beginOptimistic(client, KEY);
    patchEverywhere<Row>(client, KEY, 'a', (row) => ({ ...row, title: 'Partita' }));

    // The stale answer lands after the optimistic write, as it would in life.
    // A macrotask, not a microtask: React Query settles a query through its
    // own scheduling, and `await Promise.resolve()` returns before it has —
    // which made the first version of this test pass with the cancellation
    // removed, guarding nothing.
    resolveFetch([{ id: 'a', title: 'Sonata' }]);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(client.getQueryData<Row[]>([...KEY, 'list'])?.[0]).toMatchObject({
      title: 'Partita',
    });
    expect(typeof undo).toBe('function');
  });
});
