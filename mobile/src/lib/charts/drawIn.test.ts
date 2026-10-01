import { describe, expect, it } from 'vitest';

import { DRAW_IN_MS, drawProgress } from './drawIn';

describe('a graph drawing itself in', () => {
  it('starts empty and ends whole', () => {
    expect(drawProgress(0)).toBe(0);
    expect(drawProgress(DRAW_IN_MS)).toBe(1);
    expect(drawProgress(DRAW_IN_MS * 3)).toBe(1);
  });

  it('only ever moves forward, faster at the start than the end', () => {
    let last = 0;
    for (let ms = 0; ms <= DRAW_IN_MS; ms += 50) {
      const p = drawProgress(ms);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
    expect(drawProgress(DRAW_IN_MS / 4)).toBeGreaterThan(0.25);
  });

  it('is simply drawn when there is no time to animate in', () => {
    expect(drawProgress(10, 0)).toBe(1);
    expect(drawProgress(Number.NaN)).toBe(0);
  });
});
