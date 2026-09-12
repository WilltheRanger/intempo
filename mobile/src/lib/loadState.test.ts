import { describe, expect, it } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/query-core';

import { loadStateFor } from './loadState';

describe('loadStateFor', () => {
  it('draws the skeleton before anything has arrived', () => {
    expect(loadStateFor({ isError: false, hasData: false })).toBe('loading');
  });

  it('draws the failure only when there is nothing to draw instead', () => {
    expect(loadStateFor({ isError: true, hasData: false })).toBe('unavailable');
  });

  it('draws the content it has', () => {
    expect(loadStateFor({ isError: false, hasData: true })).toBe('ready');
  });

  /**
   * The case the module exists for, and it is not hypothetical: query-core
   * reports `status: 'error'` with the data still in hand once a *refetch*
   * fails. Every one of these screens used to cover that data with a full-page
   * "Couldn't load…", which is the one thing a musician with no signal cannot
   * use.
   */
  it('keeps drawing the content when a refetch fails underneath it', () => {
    expect(loadStateFor({ isError: true, hasData: true })).toBe('ready');
  });

  /**
   * A successful `null` — a piece that was deleted, a musician with no current
   * piece — is neither pending nor an error, so treating it as "no data" leaves
   * the screen on its skeleton for ever. It is `ready`, and the screen decides
   * what its own `null` means.
   */
  it('is ready for a successful null, so nothing loads for ever', () => {
    const answered: unknown = null;
    expect(
      loadStateFor({ isError: false, hasData: answered !== undefined }),
    ).toBe('ready');
  });
});

/**
 * The fact the module is built on, pinned against the real library rather than
 * quoted from its documentation.
 *
 * If a future version of query-core stops reporting `error` while it is holding
 * data — or starts clearing the data — this rule stops being about anything,
 * and this is the test that says so.
 */
describe('what query-core actually reports', () => {
  it('a failed refetch keeps the data and still says error', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let offline = false;
    const observer = new QueryObserver(client, {
      queryKey: ['pieces', 'list'],
      queryFn: () =>
        offline ? Promise.reject(new Error('offline')) : Promise.resolve(['a piece']),
    });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();

    offline = true;
    await observer.refetch();
    const result = observer.getCurrentResult();
    unsubscribe();

    expect(result.isError).toBe(true);
    expect(result.data).toEqual(['a piece']);
    // Which is exactly the combination the screens used to resolve the wrong
    // way round.
    expect(loadStateFor({ isError: result.isError, hasData: result.data !== undefined })).toBe(
      'ready',
    );
  });
});
