import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAudioContextForTests } from './audio/context.web';
import type { Schedule } from './score/schedule';

// The instrument voices load a bank and render it before they start. Neither is
// what these tests are about, so both hand back two seconds of silence at once:
// what is left is the start, which is where an iPhone failed on 2026-09-26.
vi.mock('./score/soundfontBank', () => ({ loadSoundfont: async () => ({}) }));
vi.mock('./score/soundfontRender', () => ({
  renderSoundfont: async () => ({
    pcm: new Int16Array(2 * 8000 * 2),
    sampleRate: 8000,
    channels: 2,
    durationS: 2,
  }),
}));

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
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    return Object.assign(new StubNode(), { buffer: null, onended: null });
  }
  suspends = 0;
  /** A browser that will not resume this context outside a gesture. */
  refuseResume = false;
  resume() {
    if (!this.refuseResume) this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.suspends += 1;
    this.state = 'suspended';
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
    //
    // **Frozen after the music started**, which is what that sentence
    // describes and what this test is for. Freezing it from the very first
    // instant is a different situation with the same readings — nothing has
    // been heard, and waiting forever is the bug below — so the two are now
    // tested apart.
    const playSchedule = await loadPlaySchedule();
    const onEnd = vi.fn();
    playSchedule(twoSeconds(), { onEnd });

    // Half a second of music, then the clock stops dead.
    audioNow += 0.5;
    vi.advanceTimersByTime(500);
    expect(onEnd).not.toHaveBeenCalled();

    // Ten seconds of wall time, no audio time at all.
    vi.advanceTimersByTime(10_000);
    expect(onEnd).not.toHaveBeenCalled();

    // The clock comes back and the piece finishes. Two seconds of wall time,
    // because the sweep re-arms for the whole remaining duration each pass —
    // so the next look is up to that far away, not on a fixed tick.
    audioNow += 3;
    vi.advanceTimersByTime(2000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('refuses a schedule it cannot measure, rather than throwing mid-way', async () => {
    /*
      **`oscillator.start()` and `.stop()` throw on a non-finite time**, and the
      throw escaped the scheduling loop — after earlier notes had already been
      started, with no handle returned to stop them and `onEnd` never called.
      A note left sounding that nothing in the app could silence, from one bad
      number, plus an exception thrown out of a press handler.

      `scheduleScore` no longer produces such a schedule; this is the second
      lock on the same door, because the door is the one that leaves sound on.
    */
    const playSchedule = await loadPlaySchedule();
    const onEnd = vi.fn();

    const handle = playSchedule(
      {
        bpm: Number.NaN,
        durationS: Number.NaN,
        notes: [
          {
            startS: 0,
            durationS: Number.NaN,
            frequency: 440,
            measureNumber: 1,
            globalIndex: 0,
          },
        ],
      },
      { onEnd },
    );

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(handle.isPlaying()).toBe(false);
    // Refused before anything was built, so the page's one context is unspent.
    expect(contexts).toHaveLength(0);
  });

  it('gives up when the clock never starts at all, instead of hanging', async () => {
    /*
      **The reported bug.** *"It gets stuck when I enter the app and listen to
      something I scanned a day ago."*

      A context that is `suspended` or — Safari's own state — `interrupted`
      has a frozen `currentTime`, and `resume()` is a promise nobody awaits
      that a browser is free to refuse. Both end conditions then fail open:
      `tick` compares elapsed time against a value that never grows, and
      `sweepForEnd` re-checks the audio clock *on purpose* and re-arms. The
      button says Stop for a piece that never started, and the only way out is
      to press it twice.

      Ending is honest here rather than a cut-off: not a note was heard.
    */
    const playSchedule = await loadPlaySchedule();
    const onEnd = vi.fn();
    const handle = playSchedule(twoSeconds(), { onEnd });

    // Wall time passes; the audio clock never moves off its starting value.
    vi.advanceTimersByTime(3000);

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(handle.isPlaying()).toBe(false);
  });

  it('kicks a clock that stopped under a running context, and plays once it moves', async () => {
    /*
      **Reported from an iPhone on 2026-09-26**: "Audio couldn't start. Tap
      Listen to retry. (AudioStartTimeout: context running after 2030ms)". A
      context that says `running` with its clock still is not waiting for a
      resume — it already has one — so after half a second of it the context
      is suspended, and the next look's resume starts it again.
    */
    const playSchedule = await loadPlaySchedule();
    const onEnd = vi.fn();
    const onError = vi.fn();
    const handle = playSchedule(twoSeconds(), { onEnd, onError });

    vi.advanceTimersByTime(400);
    expect(contexts[0].suspends).toBe(0);

    vi.advanceTimersByTime(200);
    expect(contexts[0].suspends).toBe(1);

    // Resumed by the next look, and this time the clock goes.
    vi.advanceTimersByTime(200);
    expect(contexts[0].state).toBe('running');
    audioNow += 0.5;
    vi.advanceTimersByTime(2000);

    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(handle.isPlaying()).toBe(true);
  });

  it('lets a clock that stays stopped go, so the retry plays on a new context', async () => {
    // What made the report's own advice a lie: every retry was handed the
    // same stopped context, and resuming a running context does nothing.
    const playSchedule = await loadPlaySchedule();
    const onError = vi.fn();
    playSchedule(twoSeconds(), { onError });

    vi.advanceTimersByTime(3000);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain('Tap Listen to retry.');
    expect(contexts[0].suspends).toBe(1);
    expect(contexts[0].closed).toBe(true);

    // The retry, inside a tap: a new context, and its clock runs.
    const onEnd = vi.fn();
    const handle = playSchedule(twoSeconds(), { onEnd, onError });
    expect(contexts).toHaveLength(2);
    audioNow += 0.5;
    vi.advanceTimersByTime(3000);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(handle.isPlaying()).toBe(true);
  });

  it('keeps a context that stayed suspended, for the retry to resume in the tap', async () => {
    // Suspended or interrupted all along is a resume being refused, and the
    // retry's tap is the gesture it was waiting for. Replacing it would spend
    // one of the page's few contexts for nothing.
    const playSchedule = await loadPlaySchedule();
    const onError = vi.fn();
    playSchedule(twoSeconds(), { onError });
    contexts[0].state = 'suspended';
    contexts[0].refuseResume = true;

    vi.advanceTimersByTime(3000);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(contexts[0].suspends).toBe(0);
    expect(contexts[0].closed).toBe(false);
    playSchedule(twoSeconds(), { onError });
    expect(contexts).toHaveLength(1);
  });

  it('does the same for an instrument’s voice, which is where it was reported', async () => {
    // The report was a double bass on the page-review screen: the sampled
    // voice, with its own start loop. Same rule, same recovery.
    const playSchedule = await loadPlaySchedule();
    const onError = vi.fn();
    playSchedule(twoSeconds(), { voice: 'double_bass', onError });
    await vi.advanceTimersByTimeAsync(0); // the bank and the render

    await vi.advanceTimersByTimeAsync(3000);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain('AudioStartTimeout: context running');
    expect(contexts[0].suspends).toBe(1);
    expect(contexts[0].closed).toBe(true);

    const handle = playSchedule(twoSeconds(), { voice: 'double_bass', onError });
    await vi.advanceTimersByTimeAsync(0);
    expect(contexts).toHaveLength(2);
    audioNow += 0.5;
    await vi.advanceTimersByTimeAsync(3000);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(handle.isPlaying()).toBe(true);
  });

  it('keeps waiting while the page is hidden, however long that is', async () => {
    // A frozen clock on a hidden page is explained: the musician walked away
    // rather than being failed. The give-up window is spent only while they
    // are looking at it.
    const playSchedule = await loadPlaySchedule();
    const onEnd = vi.fn();
    vi.stubGlobal('document', { hidden: true });
    playSchedule(twoSeconds(), { onEnd });

    vi.advanceTimersByTime(30_000);
    expect(onEnd).not.toHaveBeenCalled();

    // Back on screen, and it still gets its full window to start.
    vi.stubGlobal('document', { hidden: false });
    vi.advanceTimersByTime(1000);
    expect(onEnd).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
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
