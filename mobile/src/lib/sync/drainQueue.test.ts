import { beforeEach, describe, expect, it } from 'vitest';

import { drainTakes, type DrainDeps } from './drainQueue';
import {
  backoffMs,
  enqueue,
  load,
  type NewTake,
  type QueuedTake,
  type TakeStore,
} from './takeQueue';
import type { TakeFailure } from '../audio/takeFailure';

/**
 * The real sentences are **not** imported, and `import type` above is the whole
 * reason this file runs.
 *
 * `takeFailure.ts` reaches `react-native` transitively — `tierLimit` ->
 * `data/api/client` -> `data/auth/session` -> `react-native`, whose Flow syntax
 * vitest cannot parse. `takeFailure.test.ts` says the same thing and mocks
 * `../tierLimit` to get past it.
 *
 * Here there is nothing to mock: `read` is **injected**, so the drain never
 * imports the classifier at all. That is not a way around the parser, it is
 * the design — the drain and the recording screen must not each hold a copy
 * of the judgement about whether a failure is worth retrying.
 */

/**
 * Stands in for `TakeSubmissionError`, which cannot be imported here: it lives
 * beside `submitTake`, and importing that module pulls in the API client and
 * `react-native` — `submitTake.test.ts` mocks three modules to get at it.
 *
 * A stand-in is honest rather than a shortcut, because `resumeFrom` reads the
 * field **structurally** — anything carrying a `resume` object, whatever its
 * class. That is deliberate: a drain should not be coupled to one error type
 * to notice that an upload already succeeded.
 */
class FailedPartway extends Error {
  constructor(message: string, readonly resume: { audioKey?: string; analysisId?: string }) {
    super(message);
  }
}

/**
 * The pass that sends what is waiting.
 *
 * Everything here is decided in `drainQueue.ts` against an injected store, an
 * injected sender and an injected clock, which is what lets a "no signal for
 * two minutes, then signal" story be a test rather than a device session.
 * `takeDrainer.ts` is the adapter and decides nothing, so nothing about it is
 * asserted here — what a device is still needed for is whether `AppState`
 * really fires, and that is said there rather than pretended at here.
 */

function fakeStore() {
  const audio = new Map<string, Blob>();
  let entries: unknown = null;
  let frozen = false;

  const store: TakeStore & {
    audio: Map<string, Blob>;
    /** Accept writes and keep none, the way a full disk does. */
    freeze(): void;
  } = {
    audio,
    freeze() {
      frozen = true;
    },
    async read() {
      return entries;
    },
    async write(items) {
      if (frozen) {
        return;
      }
      entries = JSON.parse(JSON.stringify(items));
    },
    async putAudio(name, blob) {
      audio.set(name, blob);
    },
    async getAudio(name) {
      return audio.get(name) ?? null;
    },
    async deleteAudio(name) {
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

const CONNECTION_FAILED =
  'Your take is safe on this device. Check your connection and send it again.';
const RETRIABLE: TakeFailure = { message: CONNECTION_FAILED, retriable: true, recovery: null };
const OUT_OF_ANALYSES: TakeFailure = {
  message: 'You have used all three analyses this month.',
  retriable: false,
  recovery: null,
};

let store: ReturnType<typeof fakeStore>;
let sent: string[];
let clock: number;

beforeEach(() => {
  store = fakeStore();
  sent = [];
  clock = T0;
});

/** A drain whose sender succeeds, unless a per-id verdict says otherwise. */
function deps(
  outcome: (take: QueuedTake) => unknown = () => undefined,
  read: (error: unknown) => TakeFailure = () => RETRIABLE,
): DrainDeps {
  return {
    store,
    accountId: 'account-a',
    async submit(take) {
      const problem = outcome(take);
      if (problem) {
        throw problem;
      }
      sent.push(take.id);
    },
    read,
    now: () => clock,
  };
}

describe('account isolation', () => {
  it('never reads or submits a take recorded under another account', async () => {
    await enqueue(store, aTake({ accountId: 'account-b' }), T0, 'other-account');
    expect(await drainTakes(deps())).toEqual({
      sent: 0,
      discarded: 0,
      stopped: 'account-mismatch',
      nextDueAt: null,
    });
    expect(sent).toEqual([]);
    expect((await load(store)).takes).toHaveLength(1);
  });
});

describe('an empty or waiting queue', () => {
  it('sends nothing and asks for no timer', async () => {
    expect(await drainTakes(deps())).toEqual({
      sent: 0,
      discarded: 0,
      stopped: 'empty',
      nextDueAt: null,
    });
  });

  it('leaves a take alone until its backoff has elapsed', async () => {
    // The take failed once at T0, so it is not worth another attempt for ten
    // seconds. A drain woken at five must not spend the upload.
    await enqueue(store, aTake(), T0, 'local-1');
    await drainTakes(deps(() => new Error('no signal')));
    sent.length = 0;

    clock = T0 + 5_000;
    const report = await drainTakes(deps());

    expect(sent).toEqual([]);
    expect(report.stopped).toBe('not-due');
    // Told when to come back, so the caller sets one timer instead of polling.
    expect(report.nextDueAt).toBe(T0 + backoffMs(1));
  });
});

describe('sending', () => {
  it('sends a queued take and drops the copy', async () => {
    await enqueue(store, aTake(), T0, 'local-1');

    const report = await drainTakes(deps());

    expect(sent).toEqual(['local-1']);
    expect(report).toEqual({ sent: 1, discarded: 0, stopped: 'empty', nextDueAt: null });
    // Both halves, not just the entry: the WAV is the largest thing this app
    // writes to a device, and a queue that sends without deleting fills it.
    expect((await load(store)).takes).toEqual([]);
    expect(store.audio.size).toBe(0);
  });

  it('drains a rehearsal in one pass, oldest first', async () => {
    // Three pieces, no signal, then signal. A musician should not have to
    // visit three recording screens to find that out.
    await enqueue(store, aTake({ scoreId: 'a' }), T0, 'first');
    await enqueue(store, aTake({ scoreId: 'b' }), T0 + 1_000, 'second');
    await enqueue(store, aTake({ scoreId: 'c' }), T0 + 2_000, 'third');

    clock = T0 + 10_000;
    const report = await drainTakes(deps());

    expect(sent).toEqual(['first', 'second', 'third']);
    expect(report.sent).toBe(3);
  });

  it('reports what it managed when the rest is not due yet', async () => {
    // `later` failed at T0, so it is backing off. `ready` was recorded a
    // second afterwards and has never been tried.
    await enqueue(store, aTake(), T0, 'later');
    await drainTakes(deps(() => new Error('no signal')));

    clock = T0 + 1_000;
    await enqueue(store, aTake(), clock, 'ready');
    const report = await drainTakes(deps());

    expect(sent).toEqual(['ready']);
    // Not `empty`: something is still here, and the caller needs to come back.
    expect(report.stopped).toBe('drained');
    expect(report.nextDueAt).toBe(T0 + backoffMs(1));
  });
});

describe('failing', () => {
  it('stops the pass on the first failure rather than trying the rest', async () => {
    // The reason a take is in this queue is almost always the connection, and
    // the connection is not a property of the take. Trying the other two would
    // be two more uploads into the same dead link, on a device in a pocket.
    await enqueue(store, aTake(), T0, 'first');
    await enqueue(store, aTake(), T0 + 1_000, 'second');
    await enqueue(store, aTake(), T0 + 2_000, 'third');

    const report = await drainTakes(deps((take) => (take.id === 'first' ? new Error('no') : undefined)));

    expect(sent).toEqual([]);
    expect(report.stopped).toBe('failed');
  });

  it('keeps the take, and records why in words a musician can read', async () => {
    await enqueue(store, aTake(), T0, 'local-1');

    await drainTakes(deps(() => new Error('Failed to fetch')));

    const [take] = (await load(store)).takes;
    expect(take.attempts).toBe(1);
    expect(take.lastAttemptAt).toBe(T0);
    // Never the underlying error: "Failed to fetch" tells someone holding a
    // violin nothing they can act on.
    expect(take.lastError).toBe(CONNECTION_FAILED);
    expect(store.audio.size).toBe(1);
  });

  it('keeps the progress a failed attempt made', async () => {
    // An attempt that uploaded the WAV and then failed to create the analysis
    // has earned the object key. Throwing it away means sending the whole
    // recording again over the connection that just failed.
    await enqueue(store, aTake(), T0, 'local-1');

    await drainTakes(
      deps(() => new FailedPartway('enqueue failed', { audioKey: 'takes/abc.wav' })),
    );

    expect((await load(store)).takes[0].resume).toEqual({ audioKey: 'takes/abc.wav' });
  });

  it('stops for the month when another attempt cannot succeed', async () => {
    // The quota is the one failure a retry cannot clear — the count does not
    // move until next month. Backing off and trying again every five minutes
    // would spend a musician's battery re-earning the same refusal.
    await enqueue(store, aTake(), T0, 'local-1');
    await enqueue(store, aTake(), T0 + 1_000, 'local-2');

    const report = await drainTakes(deps(() => new Error('quota'), () => OUT_OF_ANALYSES));

    expect(report.stopped).toBe('blocked');
    expect(sent).toEqual([]);
    // Kept, both of them: the performance is the part that cannot be repeated,
    // and next month it can go.
    expect((await load(store)).takes).toHaveLength(2);
    expect((await load(store)).takes[0].lastError).toBe(OUT_OF_ANALYSES.message);
  });
});

describe('entries with nothing behind them', () => {
  it('drops an entry whose bytes are gone instead of sending it', async () => {
    // A cleared container, a failed write, an update that moved the directory.
    // Submitting this would produce a failure with no performance behind it.
    await enqueue(store, aTake(), T0, 'ghost');
    await enqueue(store, aTake(), T0 + 1_000, 'real');
    store.audio.delete('ghost.wav');

    clock = T0 + 2_000;
    const report = await drainTakes(deps());

    expect(sent).toEqual(['real']);
    expect(report.discarded).toBe(1);
    expect((await load(store)).takes).toEqual([]);
  });
});

describe('a device that cannot write', () => {
  it('stops instead of sending the same take for ever', async () => {
    // `takeQueue`'s store adapter swallows its failures by design, so a full
    // disk looks like a write that worked and changed nothing — and `load`
    // then returns the same take on every iteration. Without the guard this
    // loop uploads one WAV without end, on a device in someone's pocket.
    //
    // **Measured, and the way it fails is the point.** Remove the guard and
    // this test does not fail — it *hangs*, and vitest's own five-second
    // timeout never fires either, because every await in the loop resolves as
    // a microtask and the event loop never gets a turn for a timer to run on.
    // Killed at ninety seconds from outside. A runaway that starves the very
    // clock that would have caught it is not a thing to leave to review.
    await enqueue(store, aTake(), T0, 'local-1');
    store.freeze();

    const report = await drainTakes(deps());

    expect(sent).toEqual(['local-1']);
    expect(report.stopped).toBe('drained');
  });
});
