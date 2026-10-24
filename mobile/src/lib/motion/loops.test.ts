import { describe, expect, it } from 'vitest';

import { EASE_IN_OUT_CSS, SINE_IN_OUT_CSS, SWING_PAUSED, swingStyle } from './loops';

/** A CSS `cubic-bezier(...)` as the function of time a browser draws. */
function cssCurve(css: string): (x: number) => number {
  const [x1, y1, x2, y2] = (css.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const along = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (along(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return along(y1, y2, (lo + hi) / 2);
  };
}

/** The furthest two curves are apart, as a fraction of the travel. */
function furthestApart(a: (t: number) => number, b: (t: number) => number): number {
  let worst = 0;
  for (let i = 0; i <= 1000; i += 1) {
    worst = Math.max(worst, Math.abs(a(i / 1000) - b(i / 1000)));
  }
  return worst;
}

// React Native's own `Easing`, written out: Vitest cannot import `react-native`.
const sine = (t: number) => 1 - Math.cos((t * Math.PI) / 2);
const ease = cssCurve('cubic-bezier(0.42, 0, 1, 1)');
const inOut = (f: (t: number) => number) => (t: number) =>
  t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2;

describe('the curves the web loops ease with', () => {
  it('follow the native drift’s `Easing.inOut(Easing.sin)`', () => {
    expect(furthestApart(cssCurve(SINE_IN_OUT_CSS), inOut(sine))).toBeLessThan(0.001);
  });

  it('follow `Animated.timing`’s default, `Easing.inOut(Easing.ease)`', () => {
    expect(furthestApart(cssCurve(EASE_IN_OUT_CSS), inOut(ease))).toBeLessThan(0.006);
  });
});

describe('swingStyle', () => {
  const swing = {
    from: { opacity: 1 },
    to: { opacity: 0.45 },
    ms: 900,
    easing: EASE_IN_OUT_CSS,
  };

  it('goes from one end to the other and back, forever', () => {
    expect(swingStyle(swing)).toEqual({
      animationKeyframes: [{ '0%': { opacity: 1 }, '100%': { opacity: 0.45 } }],
      animationDuration: '900ms',
      animationTimingFunction: EASE_IN_OUT_CSS,
      animationIterationCount: 'infinite',
      animationDirection: 'alternate',
      animationDelay: '0ms',
    });
  });

  it('starts half a leg in when it begins in the middle, which a symmetric curve passes half way', () => {
    const style = swingStyle({ ...swing, easing: SINE_IN_OUT_CSS, ms: 14000, fromMiddle: true });

    expect(style.animationDelay).toBe('-7000ms');
    expect(cssCurve(SINE_IN_OUT_CSS)(0.5)).toBeCloseTo(0.5, 6);
  });

  it('pauses where it is', () => {
    expect(SWING_PAUSED).toEqual({ animationPlayState: 'paused' });
  });
});
