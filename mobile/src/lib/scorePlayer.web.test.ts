import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAudioContextForTests } from './audio/context.web';
import type { Schedule } from './score/schedule';

/**
 * Playing a score in a browser — the two rules that make Listen work *twice*.
 *
 * Both were reported as the same thing: *"Listen only works on the first
 * listen; when I come back it doesn't work, for all listening buttons"*. That
 * is one sentence covering two independent defects, and neither of them shows
 * up anywhere except the speaker, so nothing but a test on this module notices:
 *
 *  1. a context per playback, closed at the end, which iOS Safari runs out of;
 *  2. an end condition only `requestAnimationFrame` could see, which a hidden
 *     page never delivers — leaving the button stuck saying Stop.
 *
 * Driven against a stub AudioContext because both properties are structural —
 * how many contexts exist, and when `onEnd` fires — and neither needs sound.
 */

let audioNow: number;
let contexts: StubContext[];
let frameCallbacks: Map<number, () => void>;
let nextFrame: number;

class StubParam {
  value = 0;
  setValueAtTime() {}
  linearRampToValueAtTime() {}
}

class StubNode {
  gain = new StubParam();
  frequency = new StubParam();
  disconnected = false;
  started = false;
  stopped = false;
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
  setPeriodicWave() {}
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class StubContext {
  state: 'running' | 'suspended' = 'running';
  destination = {};
  closed = false;
  constructor() {
    contexts.push(this);
  }
  get currentTime() {
    return audioNow;
  }
  createGain() {
    return new StubNode();
  }
  createOscillator() {
    return new StubNode();
  }
  createPeriodicWave() {
    return {};
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

function loadPlaySchedule() {
  return import('./scorePlayer.web').then((m) => m.playSchedule);
}

/** Two seconds of music: one note, and a schedule that says so. */
function twoSeconds(): Schedule {
  return {
    bpm: 60,
    durationS: 2,
    notes: [
      {
        startS: 0,
        durationS: 2,
        frequency: 440,
        measureNumber: 1,
        globalIndex: 0,
      },
    ],
  };
}

/** A score with nothing in it — a piece still being read, on every screen. */
function empty(): Schedule {
  return { bpm: 60, durationS: 0, notes: [] };
}

/** Run every frame callback currently queued, once. */
function paintFrame() {
  const due = [...frameCallbacks.values()];
  frameCallbacks.clear();
  due.forEach((callback) => callback());
}

beforeEach(() => {
  vi.useFakeTimers();
  contexts = [];
  audioNow = 5;
  frameCallbacks = new Map();
  nextFrame = 1;
  resetAudioContextForTests();
  vi.stubGlobal('window', { AudioContext: StubContext });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    const id = nextFrame++;
    frameCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frameCallbacks.delete(id);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetAudioContextForTests();
});

describe('playing a score in a browser', () => {
  it('reuses one context across every playback, and never closes it', async () => {
    // **The first half of the reported bug.** iOS Safari caps how many audio
    // contexts a page may hold and `close()` does not reliably give the slot
    // back, so a context per Listen means the second one is born suspended or
    // not at all — with every visible sign of working.
    const playSchedule = await loadPlaySchedule();

    playSchedule(twoSeconds()).stop();
    playSchedule(twoSeconds()).stop();
    playSchedule(twoSeconds()).stop();

    expect(contexts).toHaveLength(1);
    expect(contexts[0].closed).toBe(false);
  });

  it('ends on the audio clock even when no frame is ever painted', async () => {
    // **The second half.** `requestAnimationFrame` does not run on a hidden
    // page: lock the phone mid-Listen and the frame that notices the end never
    // arrives. Without the timer sweep the handle reports playing forever and
    // the button still says Stop for a piece that finished minutes ago.
    const playSchedule = await loadPlaySchedule();
    const onEnd = vi.fn();
    const handle = playSchedule(twoSeconds(), { onEnd });

    // Not a single frame — the page was hidden for the whole piece.
    audioNow += 5;
    vi.advanceTimersByTime(5000);

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(handle.isPlaying()).toBe(false);
  });

  it('waits rather than cutting the piece off when the audio clock froze', async () => {
    // iOS suspends the audio context with the page, so `currentTime` stops
    // while wall time runs on. A sweep that trusted its own deadline would end
    // a piece that has not played a note of its second half.
    const playSchedule = await loadPlaySchedule();
    const onEnd = vi.fn();
    playSchedule(twoSeconds(), { onEnd });

    // Ten seconds of wall time, no audio time at all.
    vi.advanceTimersByTime(10_000);
    expect(onEnd).not.toHaveBeenCalled();

    // The clock comes back and the piece finishes.
    audioNow += 3;
    vi.advanceTimersByTime(1000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('stops the sweep when the musician stops it first', async () => {
    const playSchedule = await loadPlaySchedule();
    const onEnd = vi.fn();
    const handle = playSchedule(twoSeconds(), { onEnd });

    handle.stop();
    expect(onEnd).toHaveBeenCalledTimes(1);

    audioNow += 10;
    vi.advanceTimersByTime(10_000);
    paintFrame();

    // Once, not twice: `onEnd` clears the caller's playing state, and a second
    // call after they had started something else would clear that instead.
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('still reports progress from the frame loop while the page is visible', async () => {
    const playSchedule = await loadPlaySchedule();
    const onProgress = vi.fn();
    playSchedule(twoSeconds(), { onProgress });

    audioNow += 1;
    paintFrame();

    expect(onProgress).toHaveBeenCalled();
    const [elapsed, total] = onProgress.mock.calls[0];
    expect(elapsed).toBeCloseTo(1 - 0.08, 6);
    expect(total).toBe(2);
  });

  it('ends immediately, without a context, when there is nothing to play', async () => {
    const playSchedule = await loadPlaySchedule();
    const onEnd = vi.fn();
    const handle = playSchedule(empty(), { onEnd });

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(handle.isPlaying()).toBe(false);
    expect(contexts).toHaveLength(0);
  });
});
