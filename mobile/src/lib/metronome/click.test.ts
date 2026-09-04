import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The audible metronome on a device, which had no test.
 *
 * Its web sibling has one, and the argument for it applies here word for word:
 * *"the ear resolves timing an order of magnitude finer than the eye, and a
 * click that wobbles is worse than none — a musician would play the wobble."*
 * This is the half that ships on a phone.
 *
 * What cannot be checked here is the module's own stated unknown — whether the
 * JS thread's jitter is audible. There is no device in this environment and
 * this has never made a sound. What **is** knowable without one is everything
 * the file decides: which player strikes a downbeat, that a player is rewound
 * before it is struck, that a stopped track stays silent through a seek that
 * has already been issued, and that a failure to render leaves the take alone.
 *
 * Driven against stubs the way `click.web.test.ts` drives a stub AudioContext,
 * and `scorePlayer.test.ts` its player: the beat clock is replaced so beats can
 * be delivered by hand, which is what a real clock does at a less convenient
 * pace.
 */

interface StubPlayer {
  uri: string;
  seeks: number[];
  plays: number;
  removed: boolean;
}

let players: StubPlayer[];
let written: { name: string; bytes: Uint8Array }[];
let deleted: string[];
let prepareCalls: number;
/** Every side effect in the order it happened, for the ordering assertions. */
let order: string[];
let writeThrows: boolean;
/** Resolves the pending `seekTo`, so a stop mid-seek can be staged. */
let releaseSeek: (() => void) | null;
let onBeat: ((beat: { downbeat: boolean }) => void) | null;
let clockStops: number;
let plannedBeats: unknown;

vi.mock('expo-audio', () => ({
  AudioModule: {
    AudioPlayer: class {
      seeks: number[] = [];
      plays = 0;
      removed = false;
      uri: string;
      constructor(source: { uri: string }) {
        this.uri = source.uri;
        order.push(`player:${source.uri}`);
        players.push(this as unknown as StubPlayer);
      }
      seekTo(seconds: number) {
        this.seeks.push(seconds);
        return new Promise<void>((resolve) => {
          if (releaseSeek === null) {
            resolve();
          } else {
            const previous = releaseSeek;
            releaseSeek = () => {
              previous();
              resolve();
            };
          }
        });
      }
      play() {
        this.plays += 1;
      }
      remove() {
        this.removed = true;
      }
    },
  },
}));

vi.mock('expo-file-system', () => ({
  Paths: { cache: '/cache' },
  File: class {
    uri: string;
    name: string;
    constructor(_dir: unknown, name: string) {
      this.name = name;
      this.uri = `/cache/${name}`;
    }
    create() {
      if (writeThrows) {
        throw new Error('no room in the cache');
      }
    }
    write(bytes: Uint8Array) {
      order.push(`write:${this.name}`);
      written.push({ name: this.name, bytes });
    }
    delete() {
      deleted.push(this.name);
    }
  },
}));

vi.mock('../audio/session', () => ({
  prepareForPlayback: async () => {
    prepareCalls += 1;
    order.push('prepare');
  },
}));

vi.mock('./clock', () => ({
  startBeatClock: (options: { onBeat: (beat: { downbeat: boolean }) => void }) => {
    onBeat = options.onBeat;
    return { stop: () => { clockStops += 1; } };
  },
  startPlannedBeatClock: (options: {
    beats: unknown;
    onBeat: (beat: { downbeat: boolean }) => void;
  }) => {
    plannedBeats = options.beats;
    onBeat = options.onBeat;
    return { stop: () => { clockStops += 1; } };
  },
}));

async function start(options: Record<string, unknown> = {}) {
  const { startClicks } = await import('./click');
  return startClicks({ bpm: 92, perBar: 4, ...options } as never);
}

/** Let the `seekTo` promise's `.then` run. */
const settle = () => Promise.resolve().then(() => {}).then(() => {});

beforeEach(() => {
  players = [];
  written = [];
  deleted = [];
  order = [];
  prepareCalls = 0;
  writeThrows = false;
  releaseSeek = null;
  onBeat = null;
  clockStops = 0;
  plannedBeats = null;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('before it can make a sound', () => {
  it('asks for the audio session before it builds a player', async () => {
    // **The silent-switch bug.** A take leaves iOS in the recording session,
    // and an unconfigured one obeys the ring switch — so the metronome would
    // be off in exactly the quiet room a musician practises in. Ordering is
    // the fix, so ordering is what is asserted: that `prepareForPlayback` is
    // merely *called* would pass with the call moved below the players.
    await start();

    expect(prepareCalls).toBe(1);
    expect(order.indexOf('prepare')).toBeLessThan(
      order.findIndex((step) => step.startsWith('player:')),
    );
  });

  it('writes two clicks, and they are not the same sound', async () => {
    // Two players rather than one kept seeking, so a downbeat and the beat
    // before it never contend — the one part of the jitter gap this can fix
    // without a native module.
    await start();

    expect(written).toHaveLength(2);
    expect(players).toHaveLength(2);
    // No `Buffer` here: this project has no `@types/node` on purpose, so the
    // comparison goes through a plain array.
    expect(Array.from(written[0].bytes)).not.toEqual(Array.from(written[1].bytes));
  });
});

describe('striking a beat', () => {
  it('accents the downbeat and not the rest', async () => {
    // Swapped, every downbeat is the plain click and every offbeat the accent
    // — a metronome that accents the wrong beat, which a musician would play.
    await start();
    const [plain, accent] = players;

    onBeat!({ downbeat: true });
    await settle();
    expect(accent.plays).toBe(1);
    expect(plain.plays).toBe(0);

    onBeat!({ downbeat: false });
    await settle();
    expect(plain.plays).toBe(1);
    expect(accent.plays).toBe(1);
  });

  it('rewinds before it strikes', async () => {
    // A player left at the end of its file plays nothing. Without the rewind
    // the metronome sounds once and then goes silent, which is worse than not
    // starting: a musician sets a tempo, hears one click, and plays without.
    await start();
    const [plain] = players;

    onBeat!({ downbeat: false });
    await settle();
    onBeat!({ downbeat: false });
    await settle();

    expect(plain.seeks).toEqual([0, 0]);
    expect(plain.plays).toBe(2);
  });
});

describe('stopping', () => {
  it('makes no sound from a beat that arrives after it', async () => {
    const track = await start();

    track.stop();
    onBeat!({ downbeat: true });
    await settle();

    expect(players.every((p) => p.plays === 0)).toBe(true);
  });

  it('makes no sound from a seek that was already in flight', async () => {
    // The race the second guard exists for: `seekTo` is a promise, so a stop
    // between issuing it and its `.then` would otherwise still play. On a
    // phone that is a click after the take has begun, in the recording.
    releaseSeek = () => {};
    const track = await start();

    onBeat!({ downbeat: true });
    track.stop();
    releaseSeek();
    await settle();

    expect(players.every((p) => p.plays === 0)).toBe(true);
  });

  it('releases both players and both files, once', async () => {
    // These are open handles and files in the cache; a take started and
    // stopped repeatedly would otherwise leak both.
    const track = await start();

    track.stop();
    track.stop();

    expect(players.every((p) => p.removed)).toBe(true);
    expect(deleted).toEqual(['intempo-click.wav', 'intempo-click-accent.wav']);
    expect(clockStops).toBe(1);
  });
});

describe('when the clicks cannot be rendered', () => {
  it('returns a track that does nothing rather than taking the take down', async () => {
    // The metronome is an aid; the recording is the point. A cache that
    // refuses a write must not stop a musician recording.
    writeThrows = true;

    const track = await start();

    expect(track.leadInS).toBe(0);
    expect(() => track.stop()).not.toThrow();
    expect(players).toHaveLength(0);
  });
});

describe('a planned beat list', () => {
  it('is handed to the planned clock rather than the plain one', async () => {
    // A score with changing metre cannot be clicked from one bpm and a bar
    // length; `buildMetronomePlan` works the beats out and this must use them.
    const beats = [{ index: 0, downbeat: true, atS: 0, pulsesPerBar: 3 }];

    await start({ beats });

    expect(plannedBeats).toBe(beats);
  });
});
