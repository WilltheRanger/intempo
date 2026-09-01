import { describe, expect, it } from 'vitest';

import { visibleRegion } from './framing';

/** `ViewfinderPage`'s own aspect — close to A4 portrait. */
const PAGE = 0.74;

describe('visibleRegion', () => {
  it('takes a full-height slice out of a landscape capture', () => {
    // **The measured case.** Stream 3840x2160 behind a portrait page window:
    // the musician sees, and frames, 1598 px of the 3840.
    const region = visibleRegion(3840, 2160, PAGE)!;

    expect(region.height).toBe(2160);
    expect(region.width).toBe(Math.round(2160 * PAGE));
    // Centred, because `cover` centres.
    expect(region.originX).toBe(Math.round((3840 - region.width) / 2));
    expect(region.originY).toBe(0);
  });

  it('takes a full-width slice out of a capture taller than the window', () => {
    const region = visibleRegion(2000, 4000, PAGE)!;

    expect(region.width).toBe(2000);
    expect(region.height).toBe(Math.round(2000 / PAGE));
    expect(region.originX).toBe(0);
    expect(region.originY).toBe(Math.round((4000 - region.height) / 2));
  });

  it('keeps the crop inside the image', () => {
    for (const [w, h] of [[3840, 2160], [2160, 3840], [4032, 3024], [1080, 1920]]) {
      const region = visibleRegion(w, h, PAGE)!;
      expect(region.originX).toBeGreaterThanOrEqual(0);
      expect(region.originY).toBeGreaterThanOrEqual(0);
      expect(region.originX + region.width).toBeLessThanOrEqual(w);
      expect(region.originY + region.height).toBeLessThanOrEqual(h);
    }
  });

  it('is the right shape, which is the entire point', () => {
    for (const [w, h] of [[3840, 2160], [4032, 3024], [1920, 1080]]) {
      const region = visibleRegion(w, h, PAGE)!;
      expect(region.width / region.height).toBeCloseTo(PAGE, 2);
    }
  });

  it('does nothing when the capture is already the window shape', () => {
    // Null, not a full-size rectangle: a caller that got a rectangle would
    // decode and re-encode a large photograph to change nothing, which on a
    // phone browser is the difference between instant and a stall.
    expect(visibleRegion(1480, 2000, PAGE)).toBeNull();
  });

  it('refuses nonsense rather than producing a rectangle from it', () => {
    expect(visibleRegion(0, 100, PAGE)).toBeNull();
    expect(visibleRegion(100, 0, PAGE)).toBeNull();
    expect(visibleRegion(100, 100, 0)).toBeNull();
    expect(visibleRegion(Number.NaN, 100, PAGE)).toBeNull();
  });

  it('never grows the image', () => {
    // A crop that reported more pixels than it was given would be handed
    // straight to the manipulator, which would fail or pad.
    const region = visibleRegion(3840, 2160, PAGE)!;
    expect(region.width).toBeLessThanOrEqual(3840);
    expect(region.height).toBeLessThanOrEqual(2160);
  });
});
