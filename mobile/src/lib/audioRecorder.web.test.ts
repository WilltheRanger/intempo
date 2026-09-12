import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmptyRecordingError } from './audio/types';
import { audioContext, resetAudioContextForTests } from './audio/context.web';
import { startRecording } from './audioRecorder.web';

/**
 * The browser recorder, which had no test — 265 lines between a musician's
 * playing and the file the whole pipeline reads.
 *
 * Driven against a stub Web Audio graph because everything worth asserting is
 * bookkeeping: which samples were banked, what the WAV header says about them,
 * and whether a take holding nothing is refused here rather than uploaded. The
 * worklet is the one part not exercised — it runs in another thread and its
 * only job is a float-to-int16 conversion this test performs itself.
 */

const SAMPLE_RATE = 48000;

/** Chunks the fake worklet has been told to deliver, in order. */
let posted: Int16Array[];
let node: StubWorkletNode;
let tracksStopped: number;

class StubPort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(message: unknown) {
    // The real worklet answers a flush with 'flushed'. Synchronously here: the
    // recorder awaits that reply and would otherwise sit out its 250 ms
    // fallback timer on every stop.
    if (message === 'flush') {
      this.onmessage?.({ data: 'flushed' });
    }
  }
}

class StubWorkletNode {
  port = new StubPort();
  constructor() {
    node = this;
  }
  connect() {}
  disconnect() {}
  /** Hand the main thread a chunk, exactly as the worklet's transfer does. */
  deliver(samples: Int16Array) {
    posted.push(samples);
    this.port.onmessage?.({ data: samples.buffer });
  }
}

class StubContext {
  sampleRate = SAMPLE_RATE;
  state: 'running' | 'suspended' = 'running';
  destination = {};
  audioWorklet = { addModule: async () => {} };
  createMediaStreamSource() {
    return { connect: () => {}, disconnect: () => {} };
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {}
}

beforeEach(() => {
  posted = [];
  tracksStopped = 0;
  // **The recorder shares the app's one context now**, and that context is
  // module state which outlives a test. Without this, every case after the
  // first gets the previous case's stub — including its already-registered
  // worklet — and asserts against a graph it did not build.
  resetAudioContextForTests();
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [
          {
            stop: () => {
              tracksStopped += 1;
            },
          },
        ],
      }),
    },
  });
  vi.stubGlobal('window', { AudioContext: StubContext });
  vi.stubGlobal('AudioWorkletNode', StubWorkletNode);
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:worklet',
    revokeObjectURL: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** `count` samples, all of them digital silence. */
function silence(count: number): Int16Array {
  return new Int16Array(count);
}

/** Silence with one sample of the given magnitude in the middle of it. */
function silenceWith(count: number, sample: number): Int16Array {
  const chunk = new Int16Array(count);
  chunk[Math.floor(count / 2)] = sample;
  return chunk;
}

/** The 44-byte header a WAV starts with, as fields. */
async function headerOf(audio: Blob) {
  const view = new DataView(await audio.arrayBuffer());
  const ascii = (at: number) =>
    String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(at + i)));
  return {
    riff: ascii(0),
    wave: ascii(8),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  };
}

describe('startRecording (web)', () => {
  it('reports actual signal and clears it when count-in audio is discarded', async () => {
    const recorder = await startRecording();
    expect(recorder.inputPeak?.()).toBe(0);
    node.deliver(silenceWith(64, 5000));
    expect(recorder.inputPeak?.()).toBeGreaterThan(0);
    recorder.discardCapturedSoFar();
    expect(recorder.inputPeak?.()).toBe(0);
    await recorder.stop().catch(() => {});
  });
  it('resumes again when microphone setup suspends an already unlocked context', async () => {
    let resumes = 0;
    class InterruptedContext extends StubContext {
      createMediaStreamSource() {
        this.state = 'suspended';
        return super.createMediaStreamSource();
      }
      async resume() {
        resumes += 1;
        this.state = 'running';
      }
    }
    vi.stubGlobal('window', { AudioContext: InterruptedContext });
    const recorder = await startRecording();
    expect(resumes).toBe(1);
    node.deliver(silenceWith(64, 5000));
    expect((await recorder.stop()).seconds).toBeGreaterThan(0);
  });

  it('preserves captured audio and releases the mic if cleanup finds a closed graph', async () => {
    class ClosedContext extends StubContext {
      async close() { throw new DOMException('closed', 'InvalidStateError'); }
    }
    vi.stubGlobal('window', { AudioContext: ClosedContext });
    const recorder = await startRecording();
    node.deliver(silenceWith(64, 5000));
    node.port.postMessage = () => { throw new DOMException('closed', 'InvalidStateError'); };
    expect((await recorder.stop()).seconds).toBeGreaterThan(0);
    expect(tracksStopped).toBe(1);
  });

  /*
   * **This assertion used to be the other way round, and the reversal is the
   * fix for a real phone.**
   *
   * It read `['resume', 'permission']`: unlock the audio graph first, so the
   * Record tap still owned the user gesture when the context was resumed. That
   * is sound on Chromium and fatal on WebKit — resuming claims a *playback*
   * audio session, and the capture request behind it has to take the session
   * category away, which WebKit refuses with `InvalidStateError`.
   *
   * Narrowed by elimination on 2026-09-12, because the first reading was
   * wrong: the error names an inactive document, so the screen advised a
   * reload, and reloading changed nothing — the conflict is rebuilt on every
   * tap. It failed in Safari as well as the home-screen app, so the standalone
   * context was not it. It worked in Chromium on a desktop. The measurement
   * that settled it: the stock WebRTC `getUserMedia` sample recorded happily
   * in Safari **on the same phone**. Plain capture is fine there; capture
   * behind a running `AudioContext` is not, and that part is ours.
   *
   * The gesture this test was protecting is not needed once the microphone is
   * granted — a successful `getUserMedia` is itself what unlocks audio on iOS.
   * So the order inverts and the reason the old order existed goes away with
   * it.
   */
  it('takes the microphone before it builds the audio graph', async () => {
    const order: string[] = [];
    class SuspendedContext extends StubContext {
      state: 'running' | 'suspended' = 'suspended';
      constructor() {
        super();
        order.push('context');
      }
      async resume() {
        order.push('resume');
        this.state = 'running';
      }
    }
    vi.stubGlobal('window', { AudioContext: SuspendedContext });
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => {
          order.push('permission');
          return { getTracks: () => [{ stop() {} }] };
        },
      },
    });
    const recorder = await startRecording();
    // Not merely "permission is in there somewhere": the context must not even
    // be *constructed* before the microphone is in hand, since constructing one
    // is what starts the session WebKit then refuses to reassign.
    expect(order).toEqual(['permission', 'context', 'resume']);
    await recorder.stop().catch(() => {});
  });

  /*
   * **Both halves of sharing the app's one context**, and each was a way the
   * second take of a session could break while the first worked.
   */
  /*
   * **Listen, then Record — the sequence that kept failing on a real iPhone
   * after two fixes that each claimed to have solved it.**
   *
   * Listen leaves the shared context running. WebKit will not take the audio
   * session category away from a running playback context, so the capture
   * request is rejected with `InvalidStateError`. Taking the microphone before
   * building the graph does not help: the offending context predates the whole
   * call. The session has to be handed back first.
   */
  it('hands the audio session back before asking for the microphone', async () => {
    const order: string[] = [];
    class WatchedContext extends StubContext {
      async suspend() {
        order.push('suspend');
        this.state = 'suspended';
      }
      async resume() {
        order.push('resume');
        this.state = 'running';
      }
    }
    vi.stubGlobal('window', { AudioContext: WatchedContext });
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => {
          order.push('permission');
          return { getTracks: () => [{ stop() {} }] };
        },
      },
    });

    // Listen: the shared context exists and is running before Record is
    // pressed. Without this the context is built *after* the microphone and
    // there is nothing to suspend — which is why the earlier fix passed its
    // tests and failed on the phone.
    const shared = audioContext();
    expect(shared?.state).toBe('running');

    const recorder = await startRecording();

    expect(order[0]).toBe('suspend');
    expect(order.indexOf('suspend')).toBeLessThan(order.indexOf('permission'));
    // And it comes back, or the take records into a suspended graph.
    expect(order).toContain('resume');
    await recorder.stop().catch(() => {});
  });

  it('has nothing to suspend when Listen was never pressed', async () => {
    const order: string[] = [];
    class WatchedContext extends StubContext {
      async suspend() {
        order.push('suspend');
        this.state = 'suspended';
      }
    }
    vi.stubGlobal('window', { AudioContext: WatchedContext });

    const recorder = await startRecording();

    // Nothing held the session, so nothing is handed back — and in particular
    // no context is *built* just to suspend it, which `audioContext()` would
    // have done.
    expect(order).toEqual([]);
    recorder.cancel();
  });

  it('records twice without re-registering the worklet', async () => {
    let modules = 0;
    class CountingContext extends StubContext {
      audioWorklet = {
        addModule: async () => {
          modules += 1;
          if (modules > 1) {
            // What a browser actually does: the module calls
            // `registerProcessor('pcm-recorder', ...)` and a second
            // registration of the same name is refused.
            throw new DOMException('already registered', 'NotSupportedError');
          }
        },
      };
    }
    vi.stubGlobal('window', { AudioContext: CountingContext });

    const first = await startRecording();
    first.cancel();
    const second = await startRecording();
    second.cancel();

    expect(modules).toBe(1);
  });

  it('leaves the shared context open for Listen after a take', async () => {
    let closed = 0;
    class WatchedContext extends StubContext {
      async close() {
        closed += 1;
      }
    }
    vi.stubGlobal('window', { AudioContext: WatchedContext });

    const recorder = await startRecording();
    node.deliver(silenceWith(4096, 20000));
    await recorder.stop();

    expect(closed).toBe(0);
  });

  it('releases the microphone after graph failure so a retry can record', async () => {
    let closed = 0;
    let attempts = 0;
    class FailingContext extends StubContext {
      createMediaStreamSource() {
        if (attempts++ === 0)
          throw new DOMException('interrupted', 'InvalidStateError');
        return super.createMediaStreamSource();
      }
      async close() {
        closed += 1;
      }
    }
    vi.stubGlobal('window', { AudioContext: FailingContext });
    await expect(startRecording()).rejects.toThrow(/try Record again/);
    expect(tracksStopped).toBe(1);
    // **Not closed, and this assertion is the reversal.** It read `toBe(1)`
    // while every take built its own context. The context is the app's one
    // now — shared with Listen and the metronome — and closing it is the bug
    // `lib/audio/context.web.ts` exists to prevent: on iOS the slot does not
    // reliably come back, so the next Listen gets a context born suspended,
    // or none at all.
    expect(closed).toBe(0);
    const recorder = await startRecording();
    node.deliver(silenceWith(4096, 20000));
    expect((await recorder.stop()).seconds).toBeGreaterThan(0);
    expect(tracksStopped).toBe(2);
  });

  it('writes what the worklet delivered, at the rate the hardware reported', async () => {
    const recorder = await startRecording();
    node.deliver(silenceWith(4096, 12000));
    node.deliver(silenceWith(4096, -9000));

    const take = await recorder.stop();
    const header = await headerOf(take.audio);

    expect(header.riff).toBe('RIFF');
    expect(header.wave).toBe('WAVE');
    expect(header.channels).toBe(1);
    expect(header.bitsPerSample).toBe(16);
    // The rate the *graph* runs at, not the one the code asked for: a browser
    // that insists on 44.1 must not produce a file that plays 9% sharp.
    expect(header.sampleRate).toBe(SAMPLE_RATE);
    expect(header.dataBytes).toBe(8192 * 2);
    expect(take.seconds).toBeCloseTo(8192 / SAMPLE_RATE, 6);
    expect(take.truncated).toBe(false);
  });

  it('releases the microphone when the take ends', async () => {
    const recorder = await startRecording();
    node.deliver(silenceWith(64, 5000));
    await recorder.stop();

    expect(tracksStopped).toBe(1);
  });

  /**
   * **The muted-microphone take**, and the reason this file exists.
   *
   * A muted input delivers samples like any other — they are simply all zero —
   * so the old `durationOf(chunks) === 0` check passed it. The take then
   * uploaded, waited through the pipeline and came back `no_onsets`, having
   * spent one of three free analyses for the month to say nothing was heard.
   */
  it('refuses a take whose every sample is zero', async () => {
    const recorder = await startRecording();
    for (let i = 0; i < 50; i += 1) {
      node.deliver(silence(4096));
    }

    await expect(recorder.stop()).rejects.toBeInstanceOf(EmptyRecordingError);
  });

  it('still refuses a take that delivered nothing at all', async () => {
    const recorder = await startRecording();

    await expect(recorder.stop()).rejects.toBeInstanceOf(EmptyRecordingError);
  });

  /**
   * The line between the two is exact silence, and it is drawn there because
   * the onset detector is amplitude-invariant — measured identical from 0 dBFS
   * to -90. A take at the bottom of 16-bit resolution is one the pipeline can
   * read, so refusing it would take a verdict away from someone who could have
   * had one. See `lib/audio/level.ts`.
   */
  it('accepts a take holding a single bit of signal', async () => {
    const recorder = await startRecording();
    node.deliver(silence(4096));
    node.deliver(silenceWith(4096, 1));
    node.deliver(silence(4096));

    const take = await recorder.stop();

    expect(take.seconds).toBeGreaterThan(0);
  });

  it('does not let a discarded take vouch for the one that replaces it', async () => {
    // Restarting is often *because* something was wrong with the input, so a
    // peak left over from the abandoned audio is exactly the wrong thing to
    // judge the retry by.
    const recorder = await startRecording();
    node.deliver(silenceWith(4096, 20000));
    recorder.discardCapturedSoFar();
    node.deliver(silence(4096));

    await expect(recorder.stop()).rejects.toBeInstanceOf(EmptyRecordingError);
  });
});

describe('when the microphone will not start', () => {
  /** Replace `getUserMedia` with one that rejects, counting the attempts. */
  function rejectWith(...errors: unknown[]) {
    const asked: MediaStreamConstraints[] = [];
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          asked.push(constraints);
          const error = errors[asked.length - 1];
          if (error) {
            throw error;
          }
          return {
            getTracks: () => [
              {
                stop: () => {
                  tracksStopped += 1;
                },
              },
            ],
          };
        },
      },
    });
    return asked;
  }

  it('asks again without our audio preferences when they were what was refused', async () => {
    // Raw mono with every processor off is what the *analysis* wants, not what
    // the recording needs. A device that cannot give it should still record: a
    // take with echo cancellation on beats no take at all.
    const asked = rejectWith(new DOMException('nope', 'OverconstrainedError'));

    await startRecording();

    expect(asked).toHaveLength(2);
    expect(asked[0].audio).toMatchObject({ echoCancellation: false });
    expect(asked[1].audio).toBe(true);
  });

  it('does not ask twice for a refusal, which asking again cannot fix', async () => {
    const asked = rejectWith(new DOMException('nope', 'NotAllowedError'));

    await expect(startRecording()).rejects.toThrow(/permission/i);
    expect(asked).toHaveLength(1);
  });

  it('stops calling a phone with a microphone "no microphone"', async () => {
    // The bug this was reported as: on a real iPhone, every failure that was
    // not a refusal produced "No microphone is available on this device."
    const asked = rejectWith(new DOMException('busy', 'NotReadableError'));

    await expect(startRecording()).rejects.toThrow(/busy/);
    expect(asked).toHaveLength(1);
  });
});
