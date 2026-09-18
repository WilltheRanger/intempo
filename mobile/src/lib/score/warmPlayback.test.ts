import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetWarmPlaybackForTests, warmPlayback } from './warmPlayback';

// Two dynamic imports and a fetch stand between the call and the assertion,
// so one turn of the loop is not enough to see the effect.
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};

afterEach(() => {
  resetWarmPlaybackForTests();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('warmPlayback', () => {
  it('fetches the bank once per instrument, however often it is called', async () => {
    const loadSoundfont = vi.fn().mockResolvedValue({});
    vi.doMock('./soundfontBank', () => ({ loadSoundfont }));
    vi.doMock('./soundfontRender', () => ({}));
    const { warmPlayback: warm, resetWarmPlaybackForTests: reset } =
      await import('./warmPlayback');
    reset();

    warm('violin');
    warm('violin');
    warm('violin');
    await flush();

    expect(loadSoundfont).toHaveBeenCalledTimes(1);
    expect(loadSoundfont).toHaveBeenCalledWith('violin');
  });

  it('warms each instrument separately', async () => {
    const loadSoundfont = vi.fn().mockResolvedValue({});
    vi.doMock('./soundfontBank', () => ({ loadSoundfont }));
    vi.doMock('./soundfontRender', () => ({}));
    const { warmPlayback: warm, resetWarmPlaybackForTests: reset } =
      await import('./warmPlayback');
    reset();

    warm('violin');
    await flush();
    warm('cello');
    await flush();

    expect(loadSoundfont.mock.calls.map(([i]) => i)).toEqual(['violin', 'cello']);
  });

  it('does not spend a megabyte when Data Saver is on', async () => {
    const loadSoundfont = vi.fn().mockResolvedValue({});
    vi.doMock('./soundfontBank', () => ({ loadSoundfont }));
    vi.doMock('./soundfontRender', () => ({}));
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    const { warmPlayback: warm, resetWarmPlaybackForTests: reset } =
      await import('./warmPlayback');
    reset();

    warm('violin');
    await flush();

    expect(loadSoundfont).not.toHaveBeenCalled();
  });

  it('never rejects, and a failed warm is retried rather than remembered', async () => {
    const loadSoundfont = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({});
    vi.doMock('./soundfontBank', () => ({ loadSoundfont }));
    vi.doMock('./soundfontRender', () => ({}));
    const { warmPlayback: warm, resetWarmPlaybackForTests: reset } =
      await import('./warmPlayback');
    reset();

    expect(() => warm('violin')).not.toThrow();
    await flush();
    expect(loadSoundfont).toHaveBeenCalledTimes(1);

    // The failure must not be cached: pressing Listen later has to try again.
    warm('violin');
    await flush();
    expect(loadSoundfont).toHaveBeenCalledTimes(2);
  });

  it('is synchronous for the caller — a render must never await it', () => {
    expect(warmPlayback('violin')).toBeUndefined();
  });
});
