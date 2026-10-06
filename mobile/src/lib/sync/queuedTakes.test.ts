import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueuedTake, TakeStore } from './takeQueue';

/**
 * A take kept after a failed send belongs to the account that sent it.
 *
 * **The failure that ends the session is the one that lost the take.** A token
 * the API refuses makes `apiFetch` sign this device out before the error
 * reaches `RecordScreen`, and `keepTakeForLater` used to ask *then* who was
 * signed in. Nobody was, and the early return dropped the performance without a
 * word (stub API with a 401 injected, 2026-10-06). The screen now reads the
 * owner before the send begins and passes it in.
 */
const signedIn = vi.hoisted(() => ({ accountId: null as string | null }));
const stores = vi.hoisted(() => new Map<string, { entries: unknown; audio: Map<string, Blob> }>());

vi.mock('../../data/auth/session', () => ({
  getActiveAccountId: async () => signedIn.accountId,
}));

vi.mock('./takeQueue.store', () => ({
  deviceTakeStoreFor: (accountId: string): TakeStore => {
    const shelf = stores.get(accountId) ?? { entries: null, audio: new Map<string, Blob>() };
    stores.set(accountId, shelf);
    return {
      read: async () => shelf.entries,
      write: async (items) => {
        shelf.entries = JSON.parse(JSON.stringify(items));
      },
      putAudio: async (name, audio) => {
        shelf.audio.set(name, audio);
      },
      getAudio: async (name) => shelf.audio.get(name) ?? null,
      deleteAudio: async (name) => {
        shelf.audio.delete(name);
      },
    };
  },
}));

import { keepTakeForLater } from './queuedTakes';

const take = { audio: new Blob(['wav']), filename: 'take-1.wav' };
const context = {
  scoreId: 'piece-1',
  targetBpm: 72,
  metronomeMode: 'visual' as const,
  skipLongRests: false,
  fromMeasure: null,
};

function kept(accountId: string): QueuedTake[] {
  return (stores.get(accountId)?.entries as QueuedTake[] | null) ?? [];
}

beforeEach(() => {
  stores.clear();
  signedIn.accountId = null;
});

describe('keepTakeForLater', () => {
  it('keeps the take for the account that sent it, though nobody is signed in now', async () => {
    await keepTakeForLater(take, context, 'Your session has ended.', 'musician-1');

    expect(kept('musician-1').map((entry) => entry.filename)).toEqual(['take-1.wav']);
    expect(kept('musician-1')[0]?.accountId).toBe('musician-1');
  });

  it('never files it under whoever signed in since', async () => {
    signedIn.accountId = 'someone-else';

    await keepTakeForLater(take, context, 'Your session has ended.', 'musician-1');

    expect(kept('someone-else')).toEqual([]);
    expect(kept('musician-1')).toHaveLength(1);
  });

  it('asks who is signed in when the sender could not be read', async () => {
    signedIn.accountId = 'musician-1';

    await keepTakeForLater(take, context, 'Check your connection.');

    expect(kept('musician-1')).toHaveLength(1);
  });

  it('keeps nothing when nobody can be named at all', async () => {
    await keepTakeForLater(take, context, 'Check your connection.', null);

    expect(stores.size).toBe(0);
  });
});
