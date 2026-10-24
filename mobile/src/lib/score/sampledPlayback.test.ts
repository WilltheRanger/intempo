import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn() }));
vi.mock('./soundfontEngine', () => ({ loadSoundfont: mocks.load, renderSoundfont: mocks.render }));
import { beginSampledPlayback } from './sampledPlayback';
import type { Schedule } from './schedule';
const score = { notes: [], durationS: 1, bpm: 60 } as Schedule;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue([]);
  mocks.render.mockResolvedValue({
    pcm: new Int16Array(20),
    sampleRate: 44100,
    channels: 2,
    durationS: 1,
  });
});

it('reports loading then cleans up exactly once', async () => {
  const cleanup = vi.fn();
  const start = vi.fn().mockResolvedValue(cleanup);
  const loading = vi.fn();
  const end = vi.fn();
  const handle = beginSampledPlayback(
    score,
    'double_bass',
    { onLoading: loading, onEnd: end },
    start,
  );
  expect(loading).toHaveBeenCalledWith(true);
  await vi.waitFor(() => expect(loading).toHaveBeenLastCalledWith(false));
  expect(mocks.load).toHaveBeenCalledWith('double_bass');
  handle.stop();
  handle.stop();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledTimes(1);
  expect(handle.isPlaying()).toBe(false);
});
it('stop during loading prevents late playback', async () => {
  let resolve!: (value: unknown[]) => void;
  mocks.load.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const start = vi.fn();
  const end = vi.fn();
  const handle = beginSampledPlayback(score, 'cello', { onEnd: end }, start);
  await vi.waitFor(() => expect(mocks.load).toHaveBeenCalled());
  handle.stop();
  resolve([]);
  await new Promise((r) => setTimeout(r, 20));
  expect(start).not.toHaveBeenCalled();
  expect(mocks.render).not.toHaveBeenCalled();
  expect(end).toHaveBeenCalledTimes(1);
});
it('surfaces download failure without starting a synthetic fallback', async () => {
  mocks.load.mockRejectedValue(new Error('offline'));
  const start = vi.fn();
  const error = vi.fn();
  const end = vi.fn();
  const handle = beginSampledPlayback(
    score,
    'viola',
    { onError: error, onEnd: end },
    start,
  );
  await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());
  expect(error).toHaveBeenCalledWith(expect.stringContaining('retry'));
  expect(start).not.toHaveBeenCalled();
  expect(handle.isPlaying()).toBe(false);
});
it('releases a device created while cancellation was in flight', async () => {
  let resolve!: (cleanup: () => void) => void;
  const cleanup = vi.fn();
  const start = vi.fn().mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const handle = beginSampledPlayback(score, 'violin', {}, start);
  await vi.waitFor(() => expect(start).toHaveBeenCalled());
  handle.stop();
  resolve(cleanup);
  await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
});

describe('starting before the render has finished', () => {
  const STREAM = { leadS: 2.5, minSpeed: 2 };
  const RATE = 44100;
  /** Ten seconds of passage, as the renderer hands it out while it fills. */
  const passage = () => ({
    pcm: new Int16Array(RATE * 10 * 2),
    sampleRate: RATE,
    channels: 2,
    durationS: 10,
  });
  /** A start that records what it was told was final, then and afterwards. */
  function recordingStart() {
    const told: number[] = [];
    const cleanup = vi.fn();
    const start = vi.fn().mockImplementation(async (_audio, _cancelled, _finish, rendering) => {
      told.push(rendering.written());
      rendering.subscribe((written: number) => told.push(written));
      return cleanup;
    });
    return { start, told, cleanup };
  }

  it('plays the opening once enough of it is final, and reports the rest as it comes', async () => {
    const audio = passage();
    let finishRender!: () => void;
    mocks.render.mockImplementation(async (_s, _b, _i, _c, onWritten) => {
      onWritten(audio, RATE); // a second: not yet
      onWritten(audio, RATE * 3); // three: enough
      await new Promise<void>((resolve) => {
        finishRender = resolve;
      });
      onWritten(audio, RATE * 10);
      return audio;
    });
    const { start, told } = recordingStart();
    const loading = vi.fn();

    beginSampledPlayback(score, 'cello', { onLoading: loading }, start, STREAM);
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());

    expect(told).toEqual([RATE * 3]);
    // The spinner stops when the music starts, not when the render does.
    expect(loading).toHaveBeenLastCalledWith(false);
    finishRender();
    await vi.waitFor(() => expect(told).toEqual([RATE * 3, RATE * 10]));
  });

  it('plays the passage whole when the render is too slow to stay ahead of the music', async () => {
    const audio = passage();
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.render.mockImplementation(async (_s, _b, _i, _c, onWritten) => {
      now += 2000; // three seconds of music in two: 1.5 times real time
      onWritten(audio, RATE * 3);
      now += 5000;
      onWritten(audio, RATE * 10);
      return audio;
    });
    const { start, told } = recordingStart();

    beginSampledPlayback(score, 'cello', {}, start, STREAM);
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());

    expect(told).toEqual([RATE * 10]);
    clock.mockRestore();
  });

  it('plays the passage whole when the player has not asked to start early', async () => {
    const audio = passage();
    mocks.render.mockImplementation(async (_s, _b, _i, _c, onWritten) => {
      onWritten(audio, RATE * 3);
      onWritten(audio, RATE * 10);
      return audio;
    });
    const { start, told } = recordingStart();

    beginSampledPlayback(score, 'cello', {}, start);
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());

    expect(told).toEqual([RATE * 10]);
  });

  it('stops, and says why, when the render fails after the music has started', async () => {
    const audio = passage();
    mocks.render.mockImplementation(async (_s, _b, _i, _c, onWritten) => {
      onWritten(audio, RATE * 3);
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error('the synthesiser fell over');
    });
    const { start, cleanup } = recordingStart();
    const error = vi.fn();
    const end = vi.fn();

    const handle = beginSampledPlayback(score, 'cello', { onError: error, onEnd: end }, start, STREAM);
    await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());

    expect(start).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('the synthesiser fell over'));
    expect(handle.isPlaying()).toBe(false);
  });

  it('does not give up on a render still going after the music has started', async () => {
    // The deadline is for a wait that never ends. Once the music is playing
    // ahead of the render, a long passage on a slow phone is not that.
    vi.useFakeTimers();
    const audio = passage();
    let finishRender!: () => void;
    mocks.render.mockImplementation(async (_s, _b, _i, _c, onWritten) => {
      onWritten(audio, RATE * 3);
      await new Promise<void>((resolve) => {
        finishRender = resolve;
      });
      onWritten(audio, RATE * 10);
      return audio;
    });
    const { start } = recordingStart();
    const error = vi.fn();

    beginSampledPlayback(score, 'cello', { onError: error }, start, STREAM);
    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    finishRender();
    await vi.advanceTimersByTimeAsync(0);

    expect(error).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
