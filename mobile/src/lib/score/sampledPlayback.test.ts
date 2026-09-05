import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn() }));
vi.mock('./sampleBank', () => ({ loadSamples: mocks.load }));
vi.mock('./sampleRender', () => ({ renderSamples: mocks.render }));
import { beginSampledPlayback } from './sampledPlayback';
import type { Schedule } from './schedule';
const score = { notes: [], durationS: 1, bpm: 60 } as Schedule;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue([]);
  mocks.render.mockResolvedValue(new Int16Array(20));
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
  expect(mocks.load).toHaveBeenCalledWith('double_bass', score);
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
