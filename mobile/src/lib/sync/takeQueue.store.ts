import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

import { load, type QueuedTake, type TakeStore } from './takeQueue';

/**
 * Where a queued take actually lives on the device.
 *
 * The entries are small, structured and non-secret, so they go in
 * `AsyncStorage` beside `pendingAnalysis` — same shape of data, same store.
 * The bytes cannot: a WAV is megabytes and is not JSON.
 *
 * **`Paths.document`, not `Paths.cache`.** Every other file this app writes is
 * disposable — a rendered click, a listen, an export the sheet is about to
 * copy — and the cache is the right place for those, because the system may
 * clear it. A queued take is a performance that cannot be repeated. Putting it
 * somewhere the operating system is entitled to delete under memory pressure
 * would make the queue a promise the device does not keep.
 *
 * **The whole adapter is untested and says so.** Whether `expo-file-system`
 * writes where it claims needs a device, and there is none here. What that
 * costs is bounded by design rather than by hope: `enqueue` writes the bytes
 * *before* the entry, so a platform where this throws — a web build with no
 * file system among them — enqueues nothing and leaves `RecordScreen` with the
 * in-memory take it has always had. Degraded, never wrong.
 */

/** V1 has no owner. Leave it inert rather than assigning its WAV to the next login. */
const FOLDER = 'queued-takes';

function accountKey(accountId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) {
    throw new Error('Invalid account ID');
  }
  return `intempo.take-queue.v2.${accountId}`;
}

export function deviceTakeStoreFor(accountId: string): TakeStore {
  const entriesKey = accountKey(accountId);
  const folder = () => new Directory(Paths.document, FOLDER, accountId);
  const fileFor = (name: string) => {
    if (!/^[a-zA-Z0-9_.-]+\.wav$/.test(name)) {
      throw new Error('Invalid queued audio name');
    }
    return new File(folder(), name);
  };

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
      const directory = folder();
      if (!directory.exists) {
        directory.create({ intermediates: true });
      }
      const target = fileFor(name);
      target.create({ overwrite: true });
      target.write(new Uint8Array(await audio.arrayBuffer()));
    },

    async getAudio(name: string) {
      // Resolved here, from a name — never from a stored path. iOS rotates the
      // container directory on update, so yesterday's absolute path is gone
      // after a release and every queued take with it.
      const source = fileFor(name);
      if (!source.exists) {
        return null;
      }
      return new Blob([await source.bytes()], { type: 'audio/wav' });
    },

    async deleteAudio(name: string) {
      const target = fileFor(name);
      if (target.exists) {
        target.delete();
      }
    },
  };
}

/** Delete only the account whose server-side identity was removed. */
export async function deleteAccountTakes(accountId: string): Promise<void> {
  const store = deviceTakeStoreFor(accountId);
  const { takes } = await load(store);
  await AsyncStorage.removeItem(accountKey(accountId));
  for (const take of takes) {
    await store.deleteAudio(take.audioName);
  }
}
