import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Schedule } from './score/schedule';
import { DEFAULT_VOICE, VOICES } from './score/voice';

/**
 * Playing a score on a phone — the path with no tests and no device behind it.
 *
 * `scorePlayer.web.ts` has a suite; this file, which is what iOS and Android
 * actually run, had none, and its own docstring says why that matters:
 *
 * > **Unverified.** There is no simulator or device in the environment this was
 * > written in. It is built against `expo-audio`'s and `expo-file-system`'s
 * > documented APIs and typechecks, and it has never made a sound.
 *
 * Nothing here can make it make a sound either. What it can do is check the
 * parts that are arithmetic and ordering rather than audio hardware — and
 * those are where the bugs that produce silence live. The samples are decoded
 * back out of the WAV that gets written, so the assertions are about the file
 * a phone would actually be handed.
 *
 * Driven against stubs the way `scorePlayer.web.test.ts` drives the browser
 * one, and for the same reason: the properties are structural.
 */

const SAMPLE_RATE = 22050;
const HEADER_BYTES = 44;

interface WrittenFile {
  uri: string;
  bytes: Uint8Array | null;
  created: boolean;
  deleted: boolean;
}

let files: WrittenFile[];
let players: StubPlayer[];
let prepareCalls: number;
/** Recorded in call order, so "before" can be asserted rather than assumed. */
let order: string[];
let prepareFails: boolean;
let writeFails: boolean;

class StubPlayer {
  currentTime = 0;
  played = false;
  removed = false;
  constructor(public source: { uri: string }) {}
  play() {
    this.played = true;
  }
  remove() {
    this.removed = true;
  }
}

class StubFile {
  bytes: Uint8Array | null = null;
  created = false;
  deleted = false;
  uri: string;
  constructor(_dir: unknown, public name: string) {
    this.uri = `file:///cache/${name}`;
    files.push(this as unknown as WrittenFile);
  }
  create() {
    this.created = true;
  }
  write(bytes: Uint8Array) {
    if (writeFails) {
      throw new Error('disk full');
    }
    order.push('write');
    this.bytes = bytes;
  }
  delete() {
    this.deleted = true;
  }
}

vi.mock('expo-file-system', () => ({
  File: class {
    constructor(dir: unknown, name: string) {
      return new StubFile(dir, name) as never;
    }
  },
  Paths: { cache: '/cache' },
}));

vi.mock('expo-audio', () => ({
  AudioModule: {
    AudioPlayer: class {
      constructor(source: { uri: string }) {
        const player = new StubPlayer(source);
        players.push(player);
        return player as never;
      }
    },
  },
}));

vi.mock('./audio/session', () => ({
  prepareForPlayback: async () => {
    prepareCalls += 1;
    order.push('prepare');
    if (prepareFails) {
      throw new Error('session unavailable');
    }
  },
}));

async function player() {
  return (await import('./scorePlayer')).playSchedule;
}

/** One note at `startS`, so its onset can be found in the samples. */
function scheduleOf(startS: number, durationS: number, totalS: number): Schedule {
  return {
    notes: [
      { startS, durationS, frequency: 440, measureNumber: 1, globalIndex: 0 },
    ],
    durationS: totalS,
    bpm: 60,
  };
}

/** The written WAV's samples, as the phone's decoder would read them. */
function samplesOf(file: WrittenFile): Int16Array {
  const bytes = file.bytes;
  if (!bytes) {
    throw new Error('nothing was written');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = (bytes.length - HEADER_BYTES) / 2;
  const out = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = view.getInt16(HEADER_BYTES + i * 2, true);
  }
  return out;
}

/** Let the async render/write IIFE inside `playSchedule` run to completion. */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  files = [];
  players = [];
  prepareCalls = 0;
  order = [];
  prepareFails = false;
  writeFails = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe('an empty schedule', () => {
  it('ends immediately without touching the filesystem', async () => {
    // A piece whose notes could not be read is a real state — `staveScoreFor`
    // drops what it cannot draw — and rendering nothing to a file, handing it
    // to a player and waiting for a timer would leave the button saying Stop
    // forever.
    const playSchedule = await player();
    const onEnd = vi.fn();

    const handle = playSchedule({ notes: [], durationS: 0, bpm: 60 }, { onEnd });
    await settle();

    expect(onEnd).toHaveBeenCalledOnce();
    expect(handle.isPlaying()).toBe(false);
    expect(files).toHaveLength(0);
    expect(players).toHaveLength(0);
  });
});

describe('rendering a piece', () => {
  it('configures the audio session before rendering anything', async () => {
    // **The silent-switch bug, named in the module's own comment.** A take
    // leaves iOS in the recording session, and an unconfigured session obeys
    // the ring/silent switch — which is how Listen came to play nothing at all
    // on a phone on silent. Ordering is the whole fix, so ordering is what is
    // asserted; that `prepareForPlayback` is merely *called* would pass with
    // the await moved after the write.
    const playSchedule = await player();

    playSchedule(scheduleOf(0, 0.2, 0.5));
    await settle();

    expect(prepareCalls).toBe(1);
    expect(order).toEqual(['prepare', 'write']);
  });

  it('writes a WAV whose length covers the piece, its release and the tail', async () => {
    const playSchedule = await player();
    const spec = VOICES[DEFAULT_VOICE];

    playSchedule(scheduleOf(0, 0.25, 1));
    await settle();

    const expected = Math.ceil((1 + spec.releaseS + 0.2) * SAMPLE_RATE);
    expect(samplesOf(files[0])).toHaveLength(expected);
  });

  it('puts the note where the schedule says, not where it was written', async () => {
    // The one property that makes this a *reference*: a note that sounds early
    // teaches a musician to play early, and this app then measures them
    // against the timeline and tells them they rushed. Silence before the
    // onset is the assertion, because a mixing offset error moves it.
    const playSchedule = await player();
    const startS = 0.5;

    playSchedule(scheduleOf(startS, 0.25, 1));
    await settle();

    const samples = samplesOf(files[0]);
    const start = Math.floor(startS * SAMPLE_RATE);

    expect(samples.slice(0, start).every((s) => s === 0)).toBe(true);
    // The envelope opens from zero, so the attack is a ramp rather than a
    // step: sound arrives just after the start, not exactly on it.
    expect(samples.slice(start, start + 200).some((s) => s !== 0)).toBe(true);
  });

  it('hands the file it wrote to the player, and starts it', async () => {
    const playSchedule = await player();

    playSchedule(scheduleOf(0, 0.2, 0.5));
    await settle();

    expect(players).toHaveLength(1);
    expect(players[0].source.uri).toBe(files[0].uri);
    expect(players[0].played).toBe(true);
    expect(files[0].created).toBe(true);
  });
});

describe('stopping', () => {
  it('reports progress until the player reaches the end, then ends once', async () => {
    const playSchedule = await player();
    const onEnd = vi.fn();
    const onProgress = vi.fn();

    const handle = playSchedule(scheduleOf(0, 0.2, 1), { onEnd, onProgress });
    await settle();

    players[0].currentTime = 0.4;
    vi.advanceTimersByTime(100);
    expect(onProgress).toHaveBeenCalledWith(0.4, 1);
    expect(onEnd).not.toHaveBeenCalled();

    players[0].currentTime = 1;
    vi.advanceTimersByTime(100);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(handle.isPlaying()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(onEnd).toHaveBeenCalledOnce();

    // **The polling interval is cleared, and that is a separate fact.** This
    // assertion first read "so `onEnd` cannot fire twice", which was wrong and
    // vacuous: `stopped` guards the callback, so deleting `clearInterval`
    // entirely left every other assertion here passing. What clearing it
    // actually prevents is a 10 Hz timer per Listen, running for the life of
    // the process on a device — invisible except as battery.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the player and deletes the rendered file when it ends', async () => {
    // A rendered piece is megabytes and has no value once heard. The cache is
    // the system's to clear, but not clearing it here means every listen in a
    // session accumulates.
    const playSchedule = await player();

    const handle = playSchedule(scheduleOf(0, 0.2, 1));
    await settle();
    handle.stop();

    expect(players[0].removed).toBe(true);
    expect(files[0].deleted).toBe(true);
  });

  it('writes nothing when stopped before the render lands', async () => {
    // Tapping Listen and immediately tapping Stop. Rendering is off the call
    // that started playback, so the stop arrives first.
    const playSchedule = await player();
    const onEnd = vi.fn();

    const handle = playSchedule(scheduleOf(0, 0.2, 30), { onEnd });
    handle.stop();
    await settle();

    expect(onEnd).toHaveBeenCalledOnce();
    expect(players).toHaveLength(0);
    expect(files.some((f) => f.bytes !== null)).toBe(false);
  });
});

describe('when something fails', () => {
  it('ends rather than throwing if the audio session cannot be configured', async () => {
    // "A render or write failure is not worth a crash on a listen button."
    // Without `onEnd`, the button stays on Stop with nothing playing.
    const playSchedule = await player();
    const onEnd = vi.fn();
    prepareFails = true;

    playSchedule(scheduleOf(0, 0.2, 1), { onEnd });
    await settle();

    expect(onEnd).toHaveBeenCalledOnce();
    expect(players).toHaveLength(0);
  });

  it('ends rather than throwing if the file cannot be written', async () => {
    const playSchedule = await player();
    const onEnd = vi.fn();
    writeFails = true;

    playSchedule(scheduleOf(0, 0.2, 1), { onEnd });
    await settle();

    expect(onEnd).toHaveBeenCalledOnce();
    expect(players).toHaveLength(0);
  });
});
