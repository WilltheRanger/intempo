import { describe, expect, it } from 'vitest';

import {
  DISMISS_TRAVEL_FRACTION,
  DISMISS_VELOCITY,
  DRAG_ACTIVATION_DISTANCE,
  dragOffset,
  isDragGesture,
  shouldDismiss,
  trimSamples,
  UPWARD_RESISTANCE,
  velocityFrom,
  VELOCITY_WINDOW_MS,
} from './sheetDrag';

/** The add-a-piece sheet, roughly. */
const H = 320;

describe('shouldDismiss', () => {
  it('closes on a drag past the travel fraction', () => {
    const past = H * DISMISS_TRAVEL_FRACTION + 1;
    expect(shouldDismiss({ dy: past, vy: 0, height: H })).toBe(true);
  });

  it('holds on a drag short of it', () => {
    const short = H * DISMISS_TRAVEL_FRACTION - 1;
    expect(shouldDismiss({ dy: short, vy: 0, height: H })).toBe(false);
  });

  /**
   * The whole reason velocity is in the rule. A flick is short and fast, and
   * judging it on distance alone refuses the most natural way to dismiss
   * something you have already decided about.
   */
  it('closes on a fast flick that barely moved', () => {
    expect(shouldDismiss({ dy: 12, vy: DISMISS_VELOCITY, height: H })).toBe(true);
  });

  it('holds on a slow drag of the same distance', () => {
    expect(shouldDismiss({ dy: 12, vy: 0.05, height: H })).toBe(false);
  });

  /**
   * `vy` is signed, so a fast *upward* flick clears the speed threshold in
   * magnitude. Dismissing on it would close the sheet on the gesture that most
   * clearly means "keep it".
   */
  it('never closes on an upward gesture, however fast', () => {
    expect(shouldDismiss({ dy: -200, vy: -4, height: H })).toBe(false);
    expect(shouldDismiss({ dy: -1, vy: -DISMISS_VELOCITY * 10, height: H })).toBe(false);
  });

  it('does not close on no movement at all', () => {
    expect(shouldDismiss({ dy: 0, vy: 0, height: H })).toBe(false);
  });

  /**
   * `height` is 0 until the sheet has been laid out. Dividing by it would make
   * the first gesture after mount dismiss on any downward pixel.
   */
  it('falls back to velocity when the sheet has not been measured', () => {
    expect(shouldDismiss({ dy: 5, vy: 0, height: 0 })).toBe(false);
    expect(shouldDismiss({ dy: 5, vy: DISMISS_VELOCITY, height: 0 })).toBe(true);
  });

  /** A tall sheet needs a proportionally longer drag, which is the point. */
  it('scales the travel threshold with the sheet', () => {
    const tall = 800;
    const enoughForShort = H * DISMISS_TRAVEL_FRACTION + 1;
    expect(shouldDismiss({ dy: enoughForShort, vy: 0, height: H })).toBe(true);
    expect(shouldDismiss({ dy: enoughForShort, vy: 0, height: tall })).toBe(false);
  });
});

describe('dragOffset', () => {
  it('follows a downward drag exactly', () => {
    expect(dragOffset(0)).toBe(0);
    expect(dragOffset(140)).toBe(140);
  });

  it('resists upward, without pinning the sheet still', () => {
    expect(dragOffset(-100)).toBeCloseTo(-100 * UPWARD_RESISTANCE);
    expect(dragOffset(-100)).not.toBe(0);
    expect(Math.abs(dragOffset(-100))).toBeLessThan(100);
  });
});

describe('isDragGesture', () => {
  it('ignores movement below the activation distance', () => {
    expect(isDragGesture(0, DRAG_ACTIVATION_DISTANCE)).toBe(false);
    expect(isDragGesture(0, DRAG_ACTIVATION_DISTANCE + 1)).toBe(true);
  });

  /**
   * The sheets carry rows of buttons. Claiming the responder on a mostly
   * sideways gesture would pull the sheet out from under a control the finger
   * is still on.
   */
  it('refuses a gesture that is more horizontal than vertical', () => {
    expect(isDragGesture(60, 20)).toBe(false);
    expect(isDragGesture(20, 60)).toBe(true);
  });

  /** Upward drags still count as drags — the rubber-band needs to follow. */
  it('claims upward movement too', () => {
    expect(isDragGesture(0, -(DRAG_ACTIVATION_DISTANCE + 1))).toBe(true);
  });
});


describe('velocityFrom', () => {
  it('is zero without two samples to compare', () => {
    expect(velocityFrom([])).toBe(0);
    expect(velocityFrom([{ dy: 40, t: 10 }])).toBe(0);
  });

  it('measures points per millisecond across the window', () => {
    expect(velocityFrom([{ dy: 0, t: 0 }, { dy: 60, t: 60 }])).toBeCloseTo(1);
    expect(velocityFrom([{ dy: 0, t: 0 }, { dy: 60, t: 200 }])).toBeCloseTo(0.3);
  });

  /**
   * The reason for a window rather than the last pair. A flick often ends with
   * one nearly-still event, and measuring only that reads as a dead stop —
   * which is how a deliberate flick gets refused.
   */
  it('is not fooled by one stationary sample at the end', () => {
    const flick = [
      { dy: 0, t: 0 },
      { dy: 30, t: 30 },
      { dy: 60, t: 60 },
      { dy: 61, t: 66 },
    ];
    expect(velocityFrom(flick)).toBeGreaterThan(0.5);
  });

  it('ignores samples older than the window', () => {
    const paused = [
      { dy: 0, t: 0 },
      // a long pause, then a flick
      { dy: 0, t: 500 },
      { dy: 50, t: 550 },
    ];
    // 50pt in 50ms from the in-window baseline, not 50pt over 550ms.
    expect(velocityFrom(paused)).toBeCloseTo(1);
  });

  it('does not divide by a zero time delta', () => {
    expect(velocityFrom([{ dy: 0, t: 5 }, { dy: 80, t: 5 }])).toBe(0);
  });

  it('reports upward movement as negative', () => {
    expect(velocityFrom([{ dy: 0, t: 0 }, { dy: -60, t: 60 }])).toBeCloseTo(-1);
  });
});

describe('trimSamples', () => {
  it('keeps the window plus one baseline either side of it', () => {
    const now = 1000;
    const kept = trimSamples(
      [
        { dy: 0, t: 100 },
        { dy: 10, t: 500 },
        { dy: 20, t: now - VELOCITY_WINDOW_MS + 10 },
        { dy: 30, t: now },
      ],
      now,
    );
    // Two in-window samples, and the last stale one as a baseline.
    expect(kept).toHaveLength(3);
    expect(kept[0]).toEqual({ dy: 10, t: 500 });
  });

  it('leaves an already-fresh buffer alone', () => {
    const now = 100;
    const fresh = [{ dy: 0, t: 60 }, { dy: 20, t: 100 }];
    expect(trimSamples(fresh, now)).toEqual(fresh);
  });
});
