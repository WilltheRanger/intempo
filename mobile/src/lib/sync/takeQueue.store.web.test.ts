import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.delete(key);
    },
  },
}));

import { deviceTakeStoreFor } from './takeQueue.store.web';
import { enqueue, load, type NewTake } from './takeQueue';

/**
 * The browser's queued takes.
 *
 * IndexedDB itself is driven in the browser (the stub-API walk: send offline,
 * reload, send again). What is checked here is everything around it, against
 * a shelf that behaves like one: the bytes come back as the same WAV, each
 * account keeps its own, and a missing recording reads as gone.
 */

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';

function memoryShelf() {
  const items = new Map<string, { bytes: ArrayBuffer; type: string }>();
  return {
    items,
    async get(key: string) {
      return items.get(key);
    },
    async put(key: string, value: { bytes: ArrayBuffer; type: string }) {
      items.set(key, value);
    },
    async delete(key: string) {
      items.delete(key);
    },
  };
}

function aTake(accountId: string): NewTake {
  return {
    accountId,
    scoreId: 'score-1',
    targetBpm: 92,
    metronomeMode: 'off',
    filename: 'take-2026-10-06T11-00-00.wav',
    skipLongRests: false,
    fromMeasure: null,
    resume: {},
    audio: new Blob([new Uint8Array([82, 73, 70, 70, 1, 2, 3])], { type: 'audio/wav' }),
  };
}

beforeEach(() => {
  storage.clear();
});

describe('a take queued in a browser', () => {
  it('comes back as the same recording', async () => {
    const shelf = memoryShelf();
    const store = deviceTakeStoreFor(ACCOUNT_A, shelf);

    await enqueue(store, aTake(ACCOUNT_A), 1_000, 'local-1');
    const [take] = (await load(store)).takes;
    const audio = await store.getAudio(take.audioName);

    expect(audio?.type).toBe('audio/wav');
    expect([...new Uint8Array(await audio!.arrayBuffer())]).toEqual([82, 73, 70, 70, 1, 2, 3]);
  });

  it('keeps each account to its own, though the names match', async () => {
    const shelf = memoryShelf();
    await enqueue(deviceTakeStoreFor(ACCOUNT_A, shelf), aTake(ACCOUNT_A), 1_000, 'local-1');
    await enqueue(deviceTakeStoreFor(ACCOUNT_B, shelf), aTake(ACCOUNT_B), 1_000, 'local-1');

    expect(shelf.items.size).toBe(2);
    expect((await load(deviceTakeStoreFor(ACCOUNT_A, shelf))).takes).toHaveLength(1);
  });

  it('reads a recording that is gone as gone, so the queue drops its entry', async () => {
    const store = deviceTakeStoreFor(ACCOUNT_A, memoryShelf());

    expect(await store.getAudio('local-9.wav')).toBeNull();
  });

  it('removes the recording with the take', async () => {
    const shelf = memoryShelf();
    const store = deviceTakeStoreFor(ACCOUNT_A, shelf);
    await store.putAudio('local-1.wav', aTake(ACCOUNT_A).audio);

    await store.deleteAudio('local-1.wav');

    expect(shelf.items.size).toBe(0);
  });

  it('refuses a name that could reach outside the queue, and an account that is not one', async () => {
    const store = deviceTakeStoreFor(ACCOUNT_A, memoryShelf());

    await expect(store.getAudio('../other/take.wav')).rejects.toThrow('Invalid queued audio name');
    expect(() => deviceTakeStoreFor('not-an-account', memoryShelf())).toThrow('Invalid account ID');
  });

  it('will not write another account\'s take into this one\'s queue', async () => {
    const store = deviceTakeStoreFor(ACCOUNT_A, memoryShelf());

    await expect(enqueue(store, aTake(ACCOUNT_B), 1_000, 'local-1')).rejects.toThrow(
      'another account',
    );
  });
});
