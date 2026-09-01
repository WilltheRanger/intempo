import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAudioContextForTests } from '../audio/context.web';

/**
 * The audible metronome on web, which had no test.
 *
 * It is the half of the metronome that has to be right: *"the ear resolves
 * timing an order of magnitude finer than the eye, and a click that wobbles is
 * worse than none — a musician would play the wobble."*
 *
 * Driven against a stub AudioContext because the property under test is
 * arithmetic — *when* each click is booked — and that is knowable without any
 * sound. The clock is a plain number this test moves by hand, which is what a
 * real audio clock is.
 */

interface Booking {
  at: number;
  hz: number;
}

let bookings: Booking[];
let audioNow: number;
let contexts: StubContext[];

class StubParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}

class StubNode {
  type = '';
  frequency = { value: 0 };
  gain = new StubParam();
  disconnected = false;
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
  start(at: number) {
    bookings.push({ at, hz: this.frequency.value });
  }
  stop() {}
}

class StubContext {
  state: 'running' | 'suspended' = 'running';
  destination = {};
  closed = false;
  resumed = false;
  /** Every gain node this context made, oldest first. The first is the track. */
  gains: StubNode[] = [];
  constructor() {
    contexts.push(this);
  }
  get currentTime() {
    return audioNow;
  }
  createOscillator() {
    return new StubNode();
  }
  createGain() {
    const node = new StubNode();
    this.gains.push(node);
    return node;
  }
  resume() {
    this.resumed = true;
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

function loadStartClicks() {
  return import('./click.web').then((m) => m.startClicks);
}

/** Move the audio clock and let the booking timer wake up. */
function advance(seconds: number) {
  audioNow += seconds;
  vi.advanceTimersByTime(seconds * 1000);
}

beforeEach(() => {
  vi.useFakeTimers();
  bookings = [];
  contexts = [];
  audioNow = 5;
  vi.stubGlobal('window', { AudioContext: StubContext });
  // The context is shared for the life of the page (`lib/audio/context.web.ts`),
  // and a test file is one page. Without this the second test in the file would
  // be handed the first test's context and `contexts` would be empty.
  resetAudioContextForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the web click track', () => {
  it('books every click at index x period from one start, never accumulating', async () => {
    // The lookahead pattern's whole point: the timer decides *when the booking
    // happens*, and a late wake-up costs nothing because the time booked is
    // computed from the start.
    const startClicks = await loadStartClicks();
    const track = startClicks({ bpm: 120, perBar: 4 });
    const startedAt = audioNow + track.leadInS;

    advance(4);
    track.stop();

    expect(bookings.length).toBeGreaterThan(7);
    bookings.forEach((booking, index) => {
      expect(booking.at).toBeCloseTo(startedAt + index * 0.5, 9);
    });
  });

  it('books nothing late even when the waking timer is starved', async () => {
    // A backgrounded tab throttles `setInterval` to about once a second while
    // the audio clock keeps running. The clicks that fell in the gap must
    // still be booked at their own times, not at the moment they were noticed.
    const startClicks = await loadStartClicks();
    const track = startClicks({ bpm: 120, perBar: 4 });
    const startedAt = audioNow + track.leadInS;

    audioNow += 3; // three seconds of audio time, no timer ticks
    vi.advanceTimersByTime(60); // one wake-up
    track.stop();

    const times = bookings.map((b) => b.at);
    expect(times.length).toBeGreaterThan(5);
    times.forEach((at, index) => {
      expect(at).toBeCloseTo(startedAt + index * 0.5, 9);
    });
  });

  it('accents the downbeat with pitch, not with volume', async () => {
    // "A louder accent bleeds further into the microphone."
    const startClicks = await loadStartClicks();
    const track = startClicks({ bpm: 120, perBar: 3 });

    advance(4);
    track.stop();

    const accents = bookings
      .map((b, index) => ({ index, accented: b.hz > 1000 }))
      .filter((b) => b.accented)
      .map((b) => b.index);

    expect(accents.slice(0, 3)).toEqual([0, 3, 6]);
  });

  it('strikes every beat the same when there is no bar to accent', async () => {
    const startClicks = await loadStartClicks();
    const track = startClicks({ bpm: 120, perBar: null });

    advance(2);
    track.stop();

    expect(new Set(bookings.map((b) => b.hz)).size).toBe(1);
  });

  it('reports the lead-in it used, so the on-screen pulse can match it', async () => {
    // **The bug this field exists for.** The first click is booked at
    // `currentTime + 0.1` so it is not already in the past; `startBeatClock`
    // fired beat zero immediately. 100ms between seeing the beat and hearing
    // it, on every beat of every take.
    const startClicks = await loadStartClicks();
    const track = startClicks({ bpm: 60, perBar: 4 });

    expect(track.leadInS).toBeGreaterThan(0);
    expect(bookings[0].at).toBeCloseTo(5 + track.leadInS, 9);

    track.stop();
  });

  it('cuts this run off the mixer on stop, taking booked clicks with it', async () => {
    // "A click scheduled 250ms out must not sound after the take has ended."
    //
    // This used to close the whole context, and the requirement is unchanged —
    // only the instrument. The context is shared now, so cancelling has to be a
    // node: disconnecting the run's own gain silences every oscillator already
    // booked through it and leaves the mixer standing for the next run. See
    // `lib/audio/context.web.ts` for why closing it was the wrong tool.
    const startClicks = await loadStartClicks();
    const track = startClicks({ bpm: 120, perBar: 4 });

    advance(1);
    const booked = bookings.length;
    track.stop();
    advance(5);

    expect(contexts[0].gains[0].disconnected).toBe(true);
    expect(contexts[0].closed).toBe(false);
    expect(bookings).toHaveLength(booked);
  });

  it('reuses the context on a second run rather than building another', async () => {
    // **The "audio only works the first time" bug.** iOS Safari caps how many
    // audio contexts a page may hold and does not reliably return the slot on
    // close, so a per-run context means the second Listen — or the second take
    // — is silent with every other sign of working. One context, forever.
    const startClicks = await loadStartClicks();

    startClicks({ bpm: 120, perBar: 4 }).stop();
    const afterFirst = bookings.length;

    const second = startClicks({ bpm: 120, perBar: 4 });
    advance(1);
    second.stop();

    expect(contexts).toHaveLength(1);
    // And the run after a stop still books clicks: cutting the first run's
    // track must not have taken the mixer with it.
    expect(bookings.length).toBeGreaterThan(afterFirst);
  });

  it('stops twice without complaint', async () => {
    const startClicks = await loadStartClicks();
    const track = startClicks({ bpm: 120, perBar: 4 });

    track.stop();
    expect(() => track.stop()).not.toThrow();
  });

  it('resumes a context the autoplay policy handed back suspended', async () => {
    // "Without this the clicks are booked into a clock that isn't running."
    class Suspended extends StubContext {
      state: 'running' | 'suspended' = 'suspended';
    }
    vi.stubGlobal('window', { AudioContext: Suspended });

    const startClicks = await loadStartClicks();
    const track = startClicks({ bpm: 120, perBar: 4 });

    expect(contexts[0].resumed).toBe(true);
    track.stop();
  });

  it('says it will make no sound when there is no audio at all', async () => {
    vi.stubGlobal('window', {});

    const startClicks = await loadStartClicks();
    const track = startClicks({ bpm: 120, perBar: 4 });

    // Nothing will sound, so nothing has to be waited for — a lead-in here
    // would delay the on-screen pulse for a click that never comes.
    expect(track.leadInS).toBe(0);
    expect(() => track.stop()).not.toThrow();
  });
});
