import { describe, expect, it } from 'vitest';

import {
  ROW_DIVIDER_EDGE,
  ROW_PADDING_VERTICAL,
  rowDivided,
} from './rowMetrics';

/**
 * The rule that decides where a hairline goes, pinned.
 *
 * Tested rather than commented because the defect it prevents is invisible in
 * isolation: a top-ruled list and a bottom-ruled list both draw n−1 rules and
 * look identical until you put them next to each other. This app carried both
 * conventions across seventeen row implementations and nothing noticed.
 */

describe('which rows draw a rule', () => {
  it('never rules the first row — the heading above it is the boundary', () => {
    expect(rowDivided(0)).toBe(false);
  });

  it('rules every row after the first', () => {
    expect(rowDivided(1)).toBe(true);
    expect(rowDivided(2)).toBe(true);
    expect(rowDivided(99)).toBe(true);
  });

  /*
   * The property, stated as a property rather than as three examples: a group
   * of any size gets exactly one hairline between each neighbouring pair and
   * none at either end. Off by one in either direction and a group either opens
   * with a stray rule under its heading or loses the one between its last two
   * rows — the two failures the old `last` convention produced when mixed with
   * this one.
   */
  it('puts n-1 rules in a group of n, for every n', () => {
    for (const n of [1, 2, 3, 5, 40]) {
      const drawn = Array.from({ length: n }, (_, index) => rowDivided(index));
      expect(drawn.filter(Boolean)).toHaveLength(Math.max(0, n - 1));
      expect(drawn[0]).toBe(false);
    }
  });

  it('draws nothing for an empty group', () => {
    expect(Array.from({ length: 0 }, (_, i) => rowDivided(i))).toEqual([]);
  });
});

describe('the shared rhythm', () => {
  /*
   * The value, not just its presence. The survey found 16 / 12 / 8 in use
   * across seventeen rows; pinning the number is what stops a fourth appearing.
   */
  it('is one vertical rhythm', () => {
    expect(ROW_PADDING_VERTICAL).toBe(16);
  });

  /**
   * **The assertion that carries the decision.** Flipping the convention means
   * changing this line, which means reading the note in `rowMetrics.ts` about
   * why it is the top — rather than discovering the reason later, by breaking a
   * group boundary somewhere else in the app.
   */
  it('rules the top edge', () => {
    expect(ROW_DIVIDER_EDGE).toBe('top');
  });
});
