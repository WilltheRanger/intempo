import AsyncStorage from '@react-native-async-storage/async-storage';

import { load, type QueuedTake, type TakeStore } from './takeQueue';
import { checkedAudioName, takeQueueKey } from './takeQueueKeys';

/**
 * Where a queued take lives in a browser: the entries where the native build
 * keeps them, and the recording in IndexedDB.
 *
 * **The web had no queue at all.** The native store writes the WAV through
 * `expo-file-system`, which has no file system to write to in a browser, so
 * `enqueue` failed on its first step and nothing was ever queued. The
 * Record screen kept the take in memory and said "Your take is safe", which
 * held until the tab was closed or reloaded. The web is the build musicians
 * use, on their phones, and a reload discarded a performance the screen had
 * just promised to keep (measured against `stub-api.py` offline, 2026-10-06).
 *
 * IndexedDB holds binary data and is not bound by `localStorage`'s few
 * megabytes, so a take survives a reload and the drain sends it when the
 * connection is back. The bytes go in as an `ArrayBuffer` and come back as a
 * WAV `Blob`: a stored `Blob` is the thing older Safari got wrong, and a
 * buffer is plain data everywhere.
 *
 * Where IndexedDB is missing or refused (some private windows), `putAudio`
 * throws before the entry is written, which is the degraded path this build
 * always had: the take stays in the screen's hands for "Send it again".
 */

/** The three operations the queue needs on its recordings. */
interface AudioShelf {
  get(key: string): Promise<StoredAudio | undefined>;
  put(key: string, value: StoredAudio): Promise<void>;
  delete(key: string): Promise<void>;
}

interface StoredAudio {
  bytes: ArrayBuffer;
  type: string;
}

const DATABASE = 'intempo-queued-takes';
const SHELF = 'audio';

let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(SHELF);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB would not open'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked'));
    });
    // A refusal is not cached: the next attempt asks again.
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}

function onShelf<T>(
  mode: IDBTransactionMode,
  act: (shelf: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return database().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(SHELF, mode);
        const request = act(transaction.objectStore(SHELF));
        // On `complete`, not on the request's success: a write is durable only
        // once its transaction has committed.
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error ?? request.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('aborted'));
      }),
  );
}

const indexedDbShelf: AudioShelf = {
  get: (key) => onShelf('readonly', (shelf) => shelf.get(key) as IDBRequest<StoredAudio | undefined>),
  put: (key, value) => onShelf('readwrite', (shelf) => shelf.put(value, key)).then(() => undefined),
  delete: (key) => onShelf('readwrite', (shelf) => shelf.delete(key)).then(() => undefined),
};

export function deviceTakeStoreFor(
  accountId: string,
  shelf: AudioShelf = indexedDbShelf,
): TakeStore {
  const entriesKey = takeQueueKey(accountId);
  // One shelf for every account on the device, so the key carries the account.
  const keyFor = (name: string) => `${accountId}/${checkedAudioName(name)}`;

  return {
    async read() {
      const raw = await AsyncStorage.getItem(entriesKey);
      return raw ? (JSON.parse(raw) as unknown) : null;
    },

    async write(items: QueuedTake[]) {
      if (items.some((item) => item.accountId !== accountId)) {
        throw new Error('Queued take belongs to another account');
      }
      await AsyncStorage.setItem(entriesKey, JSON.stringify(items));
    },

    async putAudio(name: string, audio: Blob) {
      await shelf.put(keyFor(name), {
        bytes: await audio.arrayBuffer(),
        type: audio.type || 'audio/wav',
      });
    },

    async getAudio(name: string) {
      const stored = await shelf.get(keyFor(name));
      return stored ? new Blob([stored.bytes], { type: stored.type }) : null;
    },

    async deleteAudio(name: string) {
      await shelf.delete(keyFor(name));
    },
  };
}

/** Delete only the account whose server-side identity was removed. */
export async function deleteAccountTakes(accountId: string): Promise<void> {
  const store = deviceTakeStoreFor(accountId);
  const { takes } = await load(store);
  await AsyncStorage.removeItem(takeQueueKey(accountId));
  for (const take of takes) {
    await store.deleteAudio(take.audioName);
  }
}
