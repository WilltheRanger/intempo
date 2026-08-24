import { describe, expect, it } from 'vitest';

import { reorderTarget, slotOffsetFor } from './drag';

/**
 * Reordering the captured pages.
 *
 * The rule that was missing here changed which page the app transcribed:
 * `TranscribeScreen` uploads `pages[0]`, so a reorder nobody asked for moves a
 * different page into the position that gets read.
 */

describe('reorderTarget', () => {
  it('never moves a page on a gesture that was taken away', () => {
    // The defect. `onPanResponderTerminate` ran the identical body as
    // `onPanResponderRelease`, so a drag interrupted by a call, by the app
    // going to the background, or by the enclosing ScrollView claiming the
    // touch, committed wherever the finger happened to be. Page 1 of a
    // six-page scan came back sitting at position 3.
    expect(reorderTarget('cancelled', 0, 2)).toBeNull();
    expect(reorderTarget('cancelled', 4, -3)).toBeNull();
  });

  it('moves a page that was actually dropped somewhere else', () => {
    expect(reorderTarget('released', 0, 2)).toBe(2);
    expect(reorderTarget('released', 4, -3)).toBe(1);
  });

  it('writes nothing when the page was dropped where it started', () => {
    // A tap on the grip is a drag of zero slots, and so is a drag and a change
    // of mind. Neither should push a no-op reorder through the session.
    expect(reorderTarget('released', 3, 0)).toBeNull();
  });
});

describe('slotOffsetFor', () => {
  const PITCH = 100;

  it('picks up the page by the slot it is most in', () => {
    // Rounding, not truncation: half a row of travel is a move. Flooring would
    // make a drag feel like it lagged a row behind the finger.
    expect(slotOffsetFor(49, PITCH, 0, 6)).toBe(0);
    expect(slotOffsetFor(51, PITCH, 0, 6)).toBe(1);
    expect(slotOffsetFor(-51, PITCH, 3, 6)).toBe(-1);
    expect(slotOffsetFor(249, PITCH, 0, 6)).toBe(2);
  });

  it('stops at the ends of the list', () => {
    // There is no position above the first page or below the last, and an
    // unclamped offset reports a target the list does not have — `moveTo`
    // clamps it again, so the visible drop position and the committed one
    // would disagree.
    expect(slotOffsetFor(-900, PITCH, 0, 6)).toBe(0);
    expect(slotOffsetFor(-900, PITCH, 2, 6)).toBe(-2);
    expect(slotOffsetFor(900, PITCH, 5, 6)).toBe(0);
    expect(slotOffsetFor(900, PITCH, 3, 6)).toBe(2);
  });

  it('holds still until a row has reported its height', () => {
    // `pitch` is measured from the first row's layout. Zero divides to
    // Infinity, and `Math.round(Infinity)` clamps to the end of the list — so
    // the very first drag of a session would have jumped the page to the
    // bottom.
    expect(slotOffsetFor(120, 0, 1, 6)).toBe(0);
    expect(slotOffsetFor(120, Number.NaN, 1, 6)).toBe(0);
  });

  it('reaches every slot in a six-page scan from either end', () => {
    const total = 6;
    const fromTop = Array.from({ length: total }, (_, slot) =>
      slotOffsetFor(slot * PITCH, PITCH, 0, total),
    );
    expect(fromTop).toEqual([0, 1, 2, 3, 4, 5]);

    const fromBottom = Array.from({ length: total }, (_, slot) =>
      slotOffsetFor(-slot * PITCH, PITCH, total - 1, total),
    );
    expect(fromBottom).toEqual([0, -1, -2, -3, -4, -5]);
  });
});
