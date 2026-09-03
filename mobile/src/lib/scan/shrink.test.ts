import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

import { MIN_LONG_EDGE, SHRINK_LADDER, shrinkToFit } from './shrink';

const MB = 1024 * 1024;
const LIMIT = 10 * MB;

/** A manipulator whose output size is a function of the attempt. */
function manipulator(sizeFor: (quality: number, maxEdge: number | null) => number) {
  const calls: { quality: number; maxEdge: number | null }[] = [];
  const fn = vi.fn(async (uri: string, actions: any[], options: any) => {
    const maxEdge = actions[0]?.resize?.width ?? null;
    calls.push({ quality: options.compress, maxEdge });
    return { uri: `${uri}#q${options.compress}e${maxEdge}`, width: 0, height: 0 };
  });
  return {
    fn: fn as any,
    calls,
    measure: async (_uri: string) => {
      const call = calls[calls.length - 1];
      return sizeFor(call.quality, call.maxEdge);
    },
  };
}

describe('a page that already fits', () => {
  it('is handed back untouched, not re-encoded', async () => {
    // A lossy round trip is not free just because the file got no bigger.
    const m = manipulator(() => 1 * MB);

    const result = await shrinkToFit('page.jpg', 2 * MB, LIMIT, m.measure, m.fn);

    expect(result).toEqual({ uri: 'page.jpg', size: 2 * MB, changed: false });
    expect(m.fn).not.toHaveBeenCalled();
  });
});

describe('a page that is too large', () => {
  it('stops at the first rung that fits', async () => {
    // 14.8 MB, the size that provoked this. Quality alone is usually enough.
    const m = manipulator((quality) => (quality >= 0.9 ? 11 * MB : 4 * MB));

    const result = await shrinkToFit('page.jpg', 14.8 * MB, LIMIT, m.measure, m.fn);

    expect(result.changed).toBe(true);
    expect(result.size).toBe(4 * MB);
    expect(m.calls).toHaveLength(2);
  });

  it('spends quality before it spends pixels', async () => {
    // Resolution is what the reader needs — the server refuses a page whose
    // staff lines are under eight pixels apart — so every quality step is
    // tried at full size first.
    const m = manipulator(() => 20 * MB); // never fits, so the whole ladder runs

    await shrinkToFit('page.jpg', 30 * MB, LIMIT, m.measure, m.fn);

    const firstResize = m.calls.findIndex((c) => c.maxEdge !== null);
    const lastFullSize = m.calls.map((c) => c.maxEdge).lastIndexOf(null);
    expect(firstResize).toBeGreaterThan(lastFullSize);
  });

  it('never reduces a page below the readable floor', async () => {
    // Past this the server's own legibility check starts refusing pages, and
    // shrinking further would trade a send for an unreadable scan.
    const m = manipulator(() => 20 * MB);

    await shrinkToFit('page.jpg', 30 * MB, LIMIT, m.measure, m.fn);

    const edges = m.calls.map((c) => c.maxEdge).filter((e): e is number => e !== null);
    expect(Math.min(...edges)).toBe(MIN_LONG_EDGE);
    expect(MIN_LONG_EDGE).toBeGreaterThanOrEqual(2400);
  });

  it('hands back the smallest attempt when nothing fits', async () => {
    // So the message names the size that is actually the problem, rather than
    // the original the musician has already been told about.
    const m = manipulator((_q, maxEdge) => (maxEdge === MIN_LONG_EDGE ? 12 * MB : 25 * MB));

    const result = await shrinkToFit('page.jpg', 30 * MB, LIMIT, m.measure, m.fn);

    expect(result.size).toBe(12 * MB);
    expect(result.changed).toBe(true);
  });

  it('always re-encodes as JPEG', async () => {
    // A 14 MB PNG screenshot of a page is the other way to arrive here, and
    // re-encoding it as PNG would save almost nothing.
    const m = manipulator(() => 1 * MB);

    await shrinkToFit('page.png', 14 * MB, LIMIT, m.measure, m.fn);

    expect(m.fn.mock.calls[0][2].format).toBe('jpeg');
  });
});

describe('the ladder itself', () => {
  it('only ever gets smaller', () => {
    // A rung that undid a previous one would waste a round trip and could
    // hand back something larger than the attempt before it.
    const edges = SHRINK_LADDER.map((a) => a.maxEdge ?? Infinity);
    expect([...edges]).toEqual([...edges].sort((a, b) => b - a));
  });

  it('starts by trying quality at full resolution', () => {
    expect(SHRINK_LADDER[0].maxEdge).toBeNull();
    expect(SHRINK_LADDER[0].quality).toBeLessThan(1);
  });
});
