import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAudioContextForTests } from './audio/context.web';
import { EmptyRecordingError } from './audio/types';
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

/** Every context the page has built, and how often each was closed. */
let contexts: StubContext[];

class StubContext {
  closes = 0;
  constructor() {
    contexts.push(this);
  }
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
  async close() {
    this.closes += 1;
  }
}

beforeEach(() => {
  posted = [];
  tracksStopped = 0;
  contexts = [];
  // The context is shared and module-level, so it survives between tests
  // unless it is forgotten — the same seam `click.web.test.ts` uses.
  resetAudioContextForTests();
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => { tracksStopped += 1; } }],
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
          return { getTracks: () => [{ stop: () => { tracksStopped += 1; } }] };
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

describe('the audio context it records through', () => {
  /*
   * **The bug this is the regression test for.** `lib/audio/context.web.ts`
   * exists because a context per use is the commonest "audio works once on
   * iPhone" bug there is: Safari on iOS caps how many a page may hold and
   * `close()` does not reliably give the slot back. Both *players* were moved
   * onto the shared one. The recorder was missed, and went on building its own
   * per take and closing it — so every take spent a slot the players are also
   * drawing from, and the page runs out for all of them together.
   *
   * Nothing here can prove that is what an iPhone reported as
   * `InvalidStateError`; there is no device in this environment. What it can
   * prove is that the recorder no longer does the thing the file next to it
   * says not to.
   */
  it('is the page\'s one context, not a new one per take', async () => {
    (await startRecording()).cancel();
    (await startRecording()).cancel();

    expect(contexts).toHaveLength(1);
  });

  it('is not closed when a take ends', async () => {
    // Closing the mixer would end the next Listen too, and on iOS would not
    // give the slot back anyway.
    const recorder = await startRecording();
    node.deliver(new Int16Array([1, 2, 3, 4]));

    await recorder.stop();

    expect(contexts[0].closes).toBe(0);
  });

  it('is not closed when a take is cancelled either', async () => {
    const recorder = await startRecording();

    recorder.cancel();

    expect(contexts[0].closes).toBe(0);
  });

  it('is resumed on the way in', async () => {
    // A context can be suspended by the autoplay policy and *interrupted* by
    // anything the system decides matters more — a call, another app, the
    // microphone opening, which is exactly what is about to happen.
    resetAudioContextForTests();
    contexts = [];
    const suspended = new StubContext();
    suspended.state = 'suspended';
    vi.stubGlobal('window', { AudioContext: function () { return suspended; } });

    (await startRecording()).cancel();

    expect(suspended.state).toBe('running');
  });

  it('releases the microphone when there is no Web Audio at all', async () => {
    // The stream is already open by then: `getUserMedia` comes first, so
    // bailing out without stopping its tracks leaves the microphone live and
    // the recording indicator on with nothing recording.
    resetAudioContextForTests();
    vi.stubGlobal('window', {});
    const before = tracksStopped;

    await expect(startRecording()).rejects.toThrow(/no Web Audio/i);

    expect(tracksStopped).toBe(before + 1);
  });
});
