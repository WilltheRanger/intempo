import { describe, expect, it } from 'vitest';

import { FALL_SPAN, FALL_START, MIN_START, SETTLED_WASH, fallStops, washAt } from './heroFall';

const HEIGHT = 844;

describe('fallStops', () => {
  it('is the prototype’s fall before anything is measured', () => {
    const stops = fallStops(0, null);
    expect(stops[1]).toEqual([FALL_START, 0]);
    expect(washAt(stops, FALL_START + FALL_SPAN)).toBeCloseTo(0.984);
    expect(washAt(stops, 0.3)).toBe(0);
  });

  it('stays where the prototype put it for copy that starts low', () => {
    const stops = fallStops(HEIGHT, 0.7 * HEIGHT);
    expect(stops[1][0]).toBe(FALL_START);
  });

  it('moves the prototype’s own layout only a little', () => {
    // Its sample puts the label at about 59%, just below where the shorter
    // run has settled, so the fall rises by a point of the height, not more.
    const stops = fallStops(HEIGHT, 0.59 * HEIGHT);
    expect(FALL_START - stops[1][0]).toBeLessThan(0.02);
    expect(washAt(stops, 0.59)).toBeGreaterThanOrEqual(SETTLED_WASH);
  });

  it('starts no higher than the copy needs', () => {
    // The owner's "creeps up too high": for a two-line title starting at half
    // height, the photograph is untouched down to well past a third of it.
    const stops = fallStops(HEIGHT, 0.5 * HEIGHT);
    expect(stops[1][0]).toBeGreaterThan(0.35);
    expect(washAt(stops, 0.5)).toBeGreaterThanOrEqual(SETTLED_WASH);
  });

  it('rises to meet copy that starts high, so the first line is on settled ivory', () => {
    // A three-line title with its composer: the block starts at 47%.
    const copyTop = 0.47 * HEIGHT;
    const stops = fallStops(HEIGHT, copyTop);
    expect(stops[1][0]).toBeLessThan(FALL_START);
    expect(washAt(stops, copyTop / HEIGHT)).toBeGreaterThanOrEqual(SETTLED_WASH);
  });

  it('never climbs into the greeting', () => {
    const stops = fallStops(HEIGHT, 0.1 * HEIGHT);
    expect(stops[1][0]).toBe(MIN_START);
  });

  it('keeps its offsets in order and inside the hero', () => {
    for (const top of [null, 0, 200, 400, 600, 800]) {
      const offsets = fallStops(HEIGHT, top).map(([offset]) => offset);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
      expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...offsets)).toBeLessThanOrEqual(1);
    }
  });

  it('ends fully ivory at the bottom edge', () => {
    expect(washAt(fallStops(HEIGHT, 400), 1)).toBe(1);
  });
});
