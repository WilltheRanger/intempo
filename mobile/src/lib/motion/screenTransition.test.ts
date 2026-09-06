import { describe, expect, it } from 'vitest';

import {
  EDGE_WIDTH,
  isPopGesture,
  POP_ACTIVATION_DISTANCE,
  POP_TRAVEL_FRACTION,
  POP_VELOCITY,
  popOffset,
  SCRIM_OPACITY,
  scrimOpacity,
  shouldPop,
  startsAtEdge,
} from './screenTransition';

/** A phone, roughly. */
const W = 393;

describe('shouldPop', () => {
  it('goes back on a drag past the travel fraction', () => {
    expect(shouldPop({ dx: W * POP_TRAVEL_FRACTION + 1, vx: 0, width: W })).toBe(true);
  });

  it('stays on a drag short of it', () => {
    expect(shouldPop({ dx: W * POP_TRAVEL_FRACTION - 1, vx: 0, width: W })).toBe(false);
  });

  /**
   * The reason velocity is in the rule at all: the natural back gesture is a
   * quick pull from the edge, and it lands well short of a third of the
   * screen. Judging on distance alone refuses the common case.
   */
  it('goes back on a fast flick that barely moved', () => {
    expect(shouldPop({ dx: 14, vx: POP_VELOCITY, width: W })).toBe(true);
  });

  it('stays on a slow drag of the same distance', () => {
    expect(shouldPop({ dx: 14, vx: 0.04, width: W })).toBe(false);
  });

  /**
   * `vx` is signed, so a fast *leftward* flick clears the threshold in
   * magnitude. Going back on it would leave the screen on the gesture that
   * most clearly means stay.
   */
  it('never goes back on a leftward gesture, however fast', () => {
    expect(shouldPop({ dx: -200, vx: -4, width: W })).toBe(false);
    expect(shouldPop({ dx: -1, vx: -POP_VELOCITY * 10, width: W })).toBe(false);
  });

  it('does not go back on no movement', () => {
    expect(shouldPop({ dx: 0, vx: 0, width: W })).toBe(false);
  });

  /** Width is 0 until layout; dividing by it would pop on the first pixel. */
  it('falls back to velocity before the screen has been measured', () => {
    expect(shouldPop({ dx: 6, vx: 0, width: 0 })).toBe(false);
    expect(shouldPop({ dx: 6, vx: POP_VELOCITY, width: 0 })).toBe(true);
  });

  it('scales the travel threshold with the screen', () => {
    const enoughOnAPhone = W * POP_TRAVEL_FRACTION + 1;
    expect(shouldPop({ dx: enoughOnAPhone, vx: 0, width: W })).toBe(true);
    expect(shouldPop({ dx: enoughOnAPhone, vx: 0, width: 1024 })).toBe(false);
  });
});

describe('popOffset', () => {
  it('follows a rightward drag exactly', () => {
    expect(popOffset(0)).toBe(0);
    expect(popOffset(120)).toBe(120);
  });

  /**
   * Refused outright rather than rubber-banded, unlike the sheet. There is
   * nothing to the left of the top screen, and a screen that gives when pulled
   * towards its own edge reads as loose.
   */
  it('refuses leftward movement outright', () => {
    expect(popOffset(-1)).toBe(0);
    expect(popOffset(-200)).toBe(0);
  });
});

describe('isPopGesture', () => {
  it('ignores movement below the activation distance', () => {
    expect(isPopGesture(POP_ACTIVATION_DISTANCE, 0)).toBe(false);
    expect(isPopGesture(POP_ACTIVATION_DISTANCE + 1, 0)).toBe(true);
  });

  /**
   * A vertical scroll that began near the left edge must stay a scroll. This
   * is the test that stands between the gesture and every list in the app.
   */
  it('refuses a gesture that is more vertical than horizontal', () => {
    expect(isPopGesture(20, 60)).toBe(false);
    expect(isPopGesture(60, 20)).toBe(true);
  });

  /** Leftward is not a back gesture at any distance. */
  it('refuses leftward movement', () => {
    expect(isPopGesture(-60, 0)).toBe(false);
  });
});

describe('startsAtEdge', () => {
  it('claims only the strip along the left edge', () => {
    expect(startsAtEdge(0)).toBe(true);
    expect(startsAtEdge(EDGE_WIDTH)).toBe(true);
    expect(startsAtEdge(EDGE_WIDTH + 1)).toBe(false);
  });

  /**
   * The score scrolls sideways. A wide edge strip would swallow the first inch
   * of every horizontal swipe on it, which is why this is 20 points and not a
   * comfortable 44.
   */
  it('leaves the rest of the screen to its own content', () => {
    expect(startsAtEdge(200)).toBe(false);
  });
});

describe('scrimOpacity', () => {
  it('is nothing at the start and its peak on arrival', () => {
    expect(scrimOpacity(0)).toBe(0);
    expect(scrimOpacity(1)).toBeCloseTo(SCRIM_OPACITY);
  });

  it('tracks a half-completed gesture', () => {
    expect(scrimOpacity(0.5)).toBeCloseTo(SCRIM_OPACITY / 2);
  });

  /**
   * A spring overshoots past 1 and a drag can be released past its own end.
   * Neither may produce an opacity outside 0..SCRIM_OPACITY.
   */
  it('clamps outside the transition', () => {
    expect(scrimOpacity(1.4)).toBeCloseTo(SCRIM_OPACITY);
    expect(scrimOpacity(-0.3)).toBe(0);
  });
});
