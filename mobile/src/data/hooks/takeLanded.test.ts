import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

// The keys are the point, and they live beside hooks whose sources reach
// React Native, which vitest cannot parse. Stub what they import, not the keys.
vi.mock('../sources', () => ({}));
vi.mock('../sources/api', () => ({}));
vi.mock('../api/scores', () => ({}));
vi.mock('../environment', () => ({ IS_LIVE_BACKEND: false }));
vi.mock('../practiceTempo', () => ({}));
vi.mock('../../lib/sync/queuedTakes', () => ({}));
vi.mock('expo-image', () => ({}));

import { takeLanded } from './takeLanded';
import { insightsKeys } from './useInsights';
import { takeKeys } from './useLatestTake';
import { meKeys } from './useMe';
import { pieceKeys } from './usePieces';

/**
 * The Insights countdown sat on "1 more take to go" for about a minute after
 * the take it was waiting for had been analysed, because nothing marked it
 * stale (2026-10-20). Each key here is a screen that shows a finished take.
 */
describe('takeLanded', () => {
  function seeded(): QueryClient {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(takeKeys.recent(20), []);
    client.setQueryData(takeKeys.latest(), null);
    client.setQueryData(takeKeys.history('bwv1001'), []);
    client.setQueryData(insightsKeys.all, null);
    client.setQueryData(meKeys.all, null);
    client.setQueryData(pieceKeys.all, []);
    return client;
  }

  const stale = (client: QueryClient, key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated ?? false;

  it('marks every take list, insights, the library and the allowance stale', async () => {
    const client = seeded();
    await takeLanded(client);
    expect(stale(client, takeKeys.recent(20))).toBe(true);
    expect(stale(client, takeKeys.latest())).toBe(true);
    expect(stale(client, takeKeys.history('bwv1001'))).toBe(true);
    expect(stale(client, insightsKeys.all)).toBe(true);
    // Sorted and labelled by `lastPracticedAt`, which the take just moved.
    expect(stale(client, pieceKeys.all)).toBe(true);
    expect(stale(client, meKeys.all)).toBe(true);
  });
});
