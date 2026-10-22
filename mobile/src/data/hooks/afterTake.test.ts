import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

// The key modules' own imports reach react-native; the keys are all this needs.
vi.mock('expo-image', () => ({ Image: { prefetch: () => Promise.resolve(true) } }));
vi.mock('../sources', () => ({
  pieceSource: {},
  takeSource: {},
  insightsSource: {},
  musicianSource: {},
}));
vi.mock('../sources/api', () => ({ toPiece: (piece: unknown) => piece }));
vi.mock('../api/scores', () => ({}));
vi.mock('../practiceTempo', () => ({ practiceTempo: {} }));
vi.mock('../../lib/sync/queuedTakes', () => ({ forgetTakesFor: async () => {} }));

import { refreshAfterTake } from './afterTake';
import { insightsKeys } from './useInsights';
import { takeKeys } from './useLatestTake';
import { meKeys } from './useMe';
import { pieceKeys } from './usePieces';

/**
 * After a take, the tabs that stay mounted must refetch what it changed.
 *
 * Only `/v1/me` was marked stale, so the Library's last-practised lines and
 * Continue band, and the Insights trend, went on showing the practice from
 * before the take.
 */
describe('refreshAfterTake', () => {
  it('marks the account, the takes, insights and the pieces stale', async () => {
    const client = new QueryClient();
    const keys = [
      meKeys.all,
      takeKeys.latest(),
      takeKeys.history('piece-1'),
      insightsKeys.all,
      pieceKeys.all,
    ];
    for (const key of keys) {
      client.setQueryData(key, { cached: true });
    }

    await refreshAfterTake(client);

    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    }
  });
});
