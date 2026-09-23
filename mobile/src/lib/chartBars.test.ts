import { describe, expect, it } from 'vitest';

import { chartBarWidth } from './chartBars';

describe('chartBarWidth', () => {
  it('gives the verdict’s thirteen bars and Insights’ five passages the same bar', () => {
    // 342pt across 13 measures, and 260pt across 5 passages: the owner saw
    // needles on one and blocks on the other.
    const verdict = chartBarWidth(342 / 13);
    const insights = chartBarWidth(260 / 5);
    expect(Math.abs(verdict - insights)).toBeLessThanOrEqual(2);
  });

  it('leaves a gap a little under the bar itself', () => {
    const slot = 24;
    const bar = chartBarWidth(slot);
    expect(bar).toBeGreaterThan(slot / 2);
    expect(slot - bar).toBeGreaterThan(slot / 3);
  });

  it('never becomes a tile, however few bars there are', () => {
    expect(chartBarWidth(300)).toBe(16);
  });

  it('keeps a mark for every measure of a long piece', () => {
    expect(chartBarWidth(342 / 120)).toBeGreaterThanOrEqual(1.5);
  });

  it('draws nothing before the chart has been measured', () => {
    expect(chartBarWidth(0)).toBe(0);
    expect(chartBarWidth(Number.NaN)).toBe(0);
  });
});
