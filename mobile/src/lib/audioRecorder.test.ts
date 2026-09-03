import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The native recorder's half of the same bookkeeping the web one does.
 *
 * Worth its own test rather than trusting the shared `level.ts`: the two files
 * do not share a line of wiring, and this is the platform most takes will be
 * recorded on. `expo-audio` is mocked down to the one thing the recorder uses
 * — a stream that emits `int16` buffers and reports the rate it settled on.
 */

const listeners = vi.hoisted(() => ({ buffer: null as ((b: unknown) => void) | null }));
const streamState = vi.hoisted(() => ({
  sampleRate: 44100,
  channels: 1,
  started: false,
  stopped: false,
}));
const permission = vi.hoisted(() => ({ granted: true }));

vi.mock('expo-audio', () => ({
  AudioModule: {
    requestRecordingPermissionsAsync: async () => ({ granted: permission.granted }),
    AudioStream: class {
      get sampleRate() {
        return streamState.sampleRate;
      }
      get channels() {
        return streamState.channels;
      }
      addListener(_event: string, handler: (b: unknown) => void) {
        listeners.buffer = handler;
        return { remove: () => { listeners.buffer = null; } };
      }
      async start() {
        streamState.started = true;
      }
      stop() {
        streamState.stopped = true;
      }
    },
  },
}));

const { EmptyRecordingError, MicrophonePermissionError } = await import('./audio/types');
const { startRecording } = await import('./audioRecorder');

/** Deliver a buffer the way `expo-audio` does — an ArrayBuffer of int16. */
function deliver(samples: Int16Array) {
  listeners.buffer?.({
    data: samples.buffer.slice(0),
    sampleRate: streamState.sampleRate,
    channels: streamState.channels,
  });
}

function silence(count: number): Int16Array {
  return new Int16Array(count);
}

function silenceWith(count: number, sample: number): Int16Array {
  const chunk = new Int16Array(count);
  chunk[Math.floor(count / 2)] = sample;
  return chunk;
}

beforeEach(() => {
  permission.granted = true;
  streamState.sampleRate = 44100;
  streamState.started = false;
  streamState.stopped = false;
});

afterEach(() => {
  listeners.buffer = null;
});

describe('startRecording (native)', () => {
  it('refuses before opening the stream when permission was denied', async () => {
    permission.granted = false;

    await expect(startRecording()).rejects.toBeInstanceOf(MicrophonePermissionError);
    expect(streamState.started).toBe(false);
  });

  it('writes the rate the hardware settled on, not the one asked for', async () => {
    // 48 kHz is requested; a device that insists on 44.1 must still produce a
    // file that plays at the right pitch.
    const recorder = await startRecording();
    deliver(silenceWith(4096, 15000));

    const take = await recorder.stop();
    const view = new DataView(await take.audio.arrayBuffer());

    expect(view.getUint32(24, true)).toBe(44100);
    expect(take.sampleRate).toBe(44100);
    expect(take.seconds).toBeCloseTo(4096 / 44100, 6);
    expect(streamState.stopped).toBe(true);
  });

  /** The muted input — see `EmptyRecordingError` and `lib/audio/level.ts`. */
  it('refuses a take whose every sample is zero', async () => {
    const recorder = await startRecording();
    for (let i = 0; i < 50; i += 1) {
      deliver(silence(4096));
    }

    await expect(recorder.stop()).rejects.toBeInstanceOf(EmptyRecordingError);
  });

  it('accepts a take holding a single bit of signal', async () => {
    const recorder = await startRecording();
    deliver(silence(4096));
    deliver(silenceWith(4096, 1));

    await expect(recorder.stop()).resolves.toBeTruthy();
  });

  it('does not let a discarded take vouch for the one that replaces it', async () => {
    const recorder = await startRecording();
    deliver(silenceWith(4096, 20000));
    recorder.discardCapturedSoFar();
    deliver(silence(4096));

    await expect(recorder.stop()).rejects.toBeInstanceOf(EmptyRecordingError);
  });
});
