import { beforeEach, describe, expect, it } from 'vitest';

import {
  backoffMs,
  dueAt,
  enqueue,
  isDue,
  load,
  nextDue,
  recordFailure,
  remove,
  removeForScore,
  type NewTake,
  type QueuedTake,
  type TakeStore,
} from './takeQueue';

/**
 * The queue that makes a take survive the app being killed.
 *
 * Today `RecordScreen` holds an unsent take in a `useRef`, so it survives a
 * retry and not a restart — and a musician who records in a practice room with
 * no signal and backgrounds the app has lost the performance, which is the one
 * part of this that cannot be repeated.
 *
 * Driven against a fake store, which is the point of the store being injected:
 * every rule below is decided in `takeQueue.ts` and none of it needs a device.
 * What a device is still needed for is the adapter — whether
 * `expo-file-system` really writes where it says — and that is stated in
 * `takeQueue.store.ts` rather than pretended at here.
 */

/** A store that records what it was asked to do and can be made to fail. */
function fakeStore() {
  const audio = new Map<string, Blob>();
  let entries: unknown = null;
  const calls: string[] = [];
  let putThrows = false;

  const store: TakeStore & {
    calls: string[];
    audio: Map<string, Blob>;
    corrupt(value: unknown): void;
    failNextPut(): void;
  } = {
    calls,
    audio,
    corrupt(value: unknown) {
      entries = value;
    },
    failNextPut() {
      putThrows = true;
    },
    async read() {
      return entries;
    },
    async write(items) {
      calls.push(`write:${items.length}`);
      entries = JSON.parse(JSON.stringify(items));
    },
    async putAudio(name, blob) {
      if (putThrows) {
        putThrows = false;
        throw new Error('no room on the device');
      }
      calls.push(`putAudio:${name}`);
      audio.set(name, blob);
    },
    async getAudio(name) {
      return audio.get(name) ?? null;
    },
    async deleteAudio(name) {
      calls.push(`deleteAudio:${name}`);
      audio.delete(name);
    },
  };
  return store;
}

const T0 = 1_770_000_000_000;

function aTake(overrides: Partial<NewTake> = {}): NewTake {
  return {
    accountId: 'account-a',
    scoreId: 'score-1',
    targetBpm: 92,
    metronomeMode: 'off',
    filename: 'take-2026-09-04T10-00-00.wav',
    skipLongRests: false,
    fromMeasure: null,
    resume: {},
    audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }),
    ...overrides,
  };
}

let store: ReturnType<typeof fakeStore>;

beforeEach(() => {
  store = fakeStore();
});

describe('putting a take in', () => {
  it('writes the bytes before the entry', async () => {
    // **The ordering is the whole safety of it.** An entry pointing at bytes
    // that were never written is a take the musician can see and can never
    // send; bytes with no entry are one orphaned file. The same rule the
    // server's `pending_uploads` uses, one layer down.
    await enqueue(store, aTake(), T0, 'local-1');

    expect(store.calls).toEqual(['putAudio:local-1.wav', 'write:1']);
  });

  it('leaves no entry behind when the bytes cannot be written', async () => {
    store.failNextPut();

    await expect(enqueue(store, aTake(), T0, 'local-1')).rejects.toThrow();

    expect((await load(store)).takes).toEqual([]);
  });

  it('keeps everything the submission needs', async () => {
    const [take] = await enqueue(
      store,
      aTake({ skipLongRests: true, fromMeasure: 12, targetBpm: 60 }),
      T0,
      'local-1',
    );

    expect(take).toMatchObject({
      id: 'local-1',
      scoreId: 'score-1',
      targetBpm: 60,
      skipLongRests: true,
      fromMeasure: 12,
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      createdAt: T0,
      audioName: 'local-1.wav',
    });
  });

  it('stores a name, never a path', async () => {
    // iOS rotates the container directory on update, so an absolute path
    // stored today does not exist after the next release — which loses every
    // queued take at once, silently, on the day everybody updates.
    const [take] = await enqueue(store, aTake(), T0, 'local-1');

    expect(take.audioName).not.toContain('/');
  });

  it('keeps more than one, because a rehearsal is not one take', async () => {
    await enqueue(store, aTake(), T0, 'local-1');
    const takes = await enqueue(store, aTake({ scoreId: 'score-2' }), T0 + 5, 'local-2');

    expect(takes.map((t) => t.id)).toEqual(['local-1', 'local-2']);
  });
});

describe('taking one out', () => {
  it('removes the entry and the bytes', async () => {
    await enqueue(store, aTake(), T0, 'local-1');

    const left = await remove(store, 'local-1');

    expect(left).toEqual([]);
    expect(store.audio.size).toBe(0);
  });

  it('removes the entry even when the bytes will not delete', async () => {
    // Losing the entry is the part that matters; a file the system will clear
    // anyway must not keep a finished take in the queue forever.
    await enqueue(store, aTake(), T0, 'local-1');
    store.deleteAudio = async () => {
      throw new Error('busy');
    };

    await expect(remove(store, 'local-1')).resolves.toEqual([]);
  });

  it('is quiet about a take that is already gone', async () => {
    await expect(remove(store, 'never-existed')).resolves.toEqual([]);
  });
});

describe('when an attempt fails', () => {
  it('keeps the progress that attempt made', async () => {
    // **The idempotency pitfall the spec names.** An attempt that uploaded the
    // audio and then failed to create the analysis has earned the `audioKey`.
    // Throwing it away sends the whole WAV again over the connection that just
    // failed — and a `resume` lost between restarts is how one performance
    // costs two of three free monthly analyses.
    await enqueue(store, aTake(), T0, 'local-1');

    const [take] = await recordFailure(store, 'local-1', {
      at: T0 + 1000,
      error: 'That take couldn’t be sent.',
      resume: { audioKey: 'user-1/take.wav' },
    });

    expect(take.resume).toEqual({ audioKey: 'user-1/take.wav' });
    expect(take.attempts).toBe(1);
    expect(take.lastAttemptAt).toBe(T0 + 1000);
  });

  it('merges progress rather than replacing it', async () => {
    await enqueue(store, aTake({ resume: { audioKey: 'user-1/take.wav' } }), T0, 'l1');

    const [take] = await recordFailure(store, 'l1', {
      at: T0 + 1,
      error: 'no',
      resume: { analysisId: 'a-1' },
    });

    expect(take.resume).toEqual({ audioKey: 'user-1/take.wav', analysisId: 'a-1' });
  });

  it('keeps the sentence a musician would read, not the error', async () => {
    await enqueue(store, aTake(), T0, 'local-1');

    const [take] = await recordFailure(store, 'local-1', {
      at: T0 + 1,
      error: 'That take couldn’t be sent. It is still here.',
    });

    expect(take.lastError).not.toMatch(/Error|fetch|ECONN/);
  });
});

describe('when to try again', () => {
  it('is immediately, the first time', () => {
    const take = { createdAt: T0, attempts: 0, lastAttemptAt: null } as QueuedTake;

    expect(isDue(take, T0)).toBe(true);
  });

  it('backs off, and stops backing off at five minutes', () => {
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(2)).toBe(20_000);
    expect(backoffMs(3)).toBe(40_000);
    // **The cap matters more than the curve.** A musician who has just walked
    // back into signal should not wait an hour because the app failed four
    // times in a tunnel.
    expect(backoffMs(20)).toBe(5 * 60_000);
  });

  it('is not due inside the backoff, and is due after it', () => {
    const take = { createdAt: T0, attempts: 2, lastAttemptAt: T0 } as QueuedTake;

    expect(dueAt(take)).toBe(T0 + 20_000);
    expect(isDue(take, T0 + 19_999)).toBe(false);
    expect(isDue(take, T0 + 20_000)).toBe(true);
  });

  it('drains oldest first, so a session reads in the order it was played', async () => {
    await enqueue(store, aTake(), T0 + 100, 'later');
    const takes = await enqueue(store, aTake(), T0, 'earlier');

    expect(nextDue(takes, T0 + 200)?.id).toBe('earlier');
  });

  it('offers nothing while everything is backing off', async () => {
    await enqueue(store, aTake(), T0, 'local-1');
    const takes = await recordFailure(store, 'local-1', { at: T0, error: 'no' });

    expect(nextDue(takes, T0 + 1_000)).toBeNull();
    expect(nextDue(takes, T0 + 10_000)?.id).toBe('local-1');
  });
});

describe('reading storage written by an older build', () => {
  it('keeps what it can and counts what it cannot', async () => {
    // Storage outlives the code that wrote it. A shape read as valid produces
    // a submission missing a field the server now requires, failing for a
    // reason no message explains; one silently dropped costs a performance.
    // Counting them puts the number in front of somebody.
    await enqueue(store, aTake(), T0, 'local-1');
    const kept = (await load(store)).takes;
    store.corrupt([...kept, { id: 'from-2025', scoreId: 'x' }, null, 'nonsense']);

    const loaded = await load(store);

    expect(loaded.takes.map((t) => t.id)).toEqual(['local-1']);
    expect(loaded.unreadable).toBe(3);
  });

  it('reads nothing as an empty queue rather than a crash', async () => {
    store.corrupt(undefined);
    await expect(load(store)).resolves.toEqual({ takes: [], unreadable: 0 });

    store.corrupt({ not: 'an array' });
    await expect(load(store)).resolves.toEqual({ takes: [], unreadable: 0 });
  });

  it('survives a store that will not read at all', async () => {
    store.read = async () => {
      throw new Error('storage unavailable');
    };

    await expect(load(store)).resolves.toEqual({ takes: [], unreadable: 0 });
  });
});


/**
 * Deleting a piece takes its unsent takes with it.
 *
 * **Nothing did this**, and what was left behind is worse than a leak. The
 * entry's WAV is up to 50 MB and stays for the life of the install, because
 * the only thing that drops an entry unasked is `restoreQueuedTake` noticing
 * the bytes are gone — and they are not. Meanwhile the drain retries it
 * against a score the server answers 404 for, and a pass stops at the first
 * failure by design, so one orphan sits at the head of the queue and blocks
 * every real take behind it.
 */
describe('a piece that was deleted', () => {
  it('takes its queued takes and their audio with it', async () => {
    await enqueue(store, aTake({ scoreId: 'going' }), T0, 'a');
    await enqueue(store, aTake({ scoreId: 'going' }), T0 + 1, 'b');

    const left = await removeForScore(store, 'going');

    expect(left).toEqual([]);
    expect((await load(store)).takes).toEqual([]);
    // The bytes too. An entry removed while its file stays is the leak with
    // the evidence deleted.
    expect(store.audio.size).toBe(0);
  });

  it('leaves the takes of every other piece alone', async () => {
    // The failure that would be worst here: deleting one piece silently
    // discarding a performance of another.
    await enqueue(store, aTake({ scoreId: 'going' }), T0, 'a');
    await enqueue(store, aTake({ scoreId: 'staying' }), T0 + 1, 'b');
    await enqueue(store, aTake({ scoreId: 'staying' }), T0 + 2, 'c');

    const left = await removeForScore(store, 'going');

    expect(left.map((take) => take.id)).toEqual(['b', 'c']);
    expect(store.audio.size).toBe(2);
  });

  it('does not write when the piece had nothing queued', async () => {
    // The common case by far — most pieces have no unsent take — and a write
    // per delete would be a file rewritten for nothing.
    await enqueue(store, aTake({ scoreId: 'staying' }), T0, 'a');
    const before = store.calls.length;

    await removeForScore(store, 'never-recorded');

    expect(store.calls.length).toBe(before);
    expect((await load(store)).takes).toHaveLength(1);
  });

  it('survives a store that will not delete the audio', async () => {
    // The entry going is the part that matters; a file the system will clear
    // anyway must not make a delete look like it failed.
    await enqueue(store, aTake({ scoreId: 'going' }), T0, 'a');
    store.deleteAudio = async () => {
      throw new Error('the file is locked');
    };

    await expect(removeForScore(store, 'going')).resolves.toEqual([]);
    expect((await load(store)).takes).toEqual([]);
  });
});
