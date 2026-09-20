import { describe, expect, it } from 'vitest';

import { settleVelocity, springVelocityFrom } from './springHandoff';

describe('springVelocityFrom', () => {
  /**
   * **The bug this module exists to prevent.** Gestures here are measured in
   * points per millisecond and `Animated.spring` wants points per second, and
   * nothing in either type says so — both are `number`. Getting it wrong by
   * 1000× compiles, typechecks, and produces a spring that looks very slightly
   * lazy rather than one that looks broken.
   */
  it('converts points per millisecond to the points per second a spring wants', () => {
    expect(springVelocityFrom(0.5)).toBe(500);
    expect(springVelocityFrom(1.2)).toBe(1200);
  });

  it('keeps the sign, because the direction is the whole signal', () => {
    expect(springVelocityFrom(-0.4)).toBe(-400);
  });

  it('is zero at rest', () => {
    expect(springVelocityFrom(0)).toBe(0);
  });

  /**
   * `velocityFrom` divides by a time delta. Two samples sharing a timestamp
   * is not exotic on a device under load, and a `NaN` reaching the animation
   * driver is a sheet parked off-screen with no way back — a far worse
   * outcome than a spring that merely starts from rest.
   */
  it('refuses a non-finite velocity rather than passing it to the driver', () => {
    expect(springVelocityFrom(NaN)).toBe(0);
    expect(springVelocityFrom(Infinity)).toBe(0);
    expect(springVelocityFrom(-Infinity)).toBe(0);
  });
});

describe('settleVelocity', () => {
  it('hands over a flick that is already heading for the target', () => {
    // Sheet at 40, closing towards 300, finger moving down: carry it.
    expect(settleVelocity(0.8, { from: 40, to: 300 })).toBe(800);
  });

  it('hands over an upward flick heading for an upward target', () => {
    expect(settleVelocity(-0.6, { from: 200, to: 0 })).toBe(-600);
  });

  /**
   * The cancelled drag. Physically a spring handed velocity pointing away
   * from its target is honest — it carries on, turns round and comes back —
   * but on a two-position sheet that reads as a bounce, and a musician cannot
   * tell "I did not move it far enough" from "it did something I did not ask
   * for". Real sheets return directly.
   */
  it('drops velocity that points away from where the sheet is going', () => {
    // Tugged down but not far enough: target is back up at 0.
    expect(settleVelocity(0.3, { from: 60, to: 0 })).toBe(0);
    // Tugged up but not far enough: target is back down at 300.
    expect(settleVelocity(-0.3, { from: 240, to: 300 })).toBe(0);
  });

  it('is zero when there is nowhere to go', () => {
    expect(settleVelocity(0.9, { from: 120, to: 120 })).toBe(0);
  });

  it('carries the unit conversion, so a caller cannot do it twice', () => {
    expect(settleVelocity(0.25, { from: 0, to: 100 })).toBe(250);
  });
});
