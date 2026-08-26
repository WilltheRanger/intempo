import { describe, expect, it } from 'vitest';

import { cameraCanPhotographAPage } from './pageCamera';

/**
 * Which devices are offered the camera as a way to scan a page.
 *
 * The refusal that prompted this, from the deployment: a page photographed on
 * a laptop webcam measured **6 px** between staff lines against a floor of 8,
 * and was correctly turned away. The advice in the refusal was "with a phone
 * rather than a webcam" — pointing away from a button the app had shown them
 * two screens earlier.
 */

describe('a real app build', () => {
  it('always offers the camera', () => {
    // There is no desktop target. Anything running natively is a phone or a
    // tablet, and its rear camera is the best camera in this product.
    for (const os of ['ios', 'android']) {
      expect(cameraCanPhotographAPage({ os })).toBe(true);
    }
  });
});

describe('a browser that says what it is', () => {
  it('is believed', () => {
    expect(cameraCanPhotographAPage({ os: 'web', mobileHint: true })).toBe(true);
    expect(cameraCanPhotographAPage({ os: 'web', mobileHint: false })).toBe(false);
  });

  it('is believed over the touch signals', () => {
    // A touchscreen laptop reports touch points and `mobile: false`. The
    // browser knows better than the heuristic.
    expect(
      cameraCanPhotographAPage({ os: 'web', mobileHint: false, maxTouchPoints: 10 }),
    ).toBe(false);
  });
});

describe('a browser that does not', () => {
  it('takes a touchscreen as a phone', () => {
    // Safari and Firefox do not report `userAgentData.mobile`, and iPhone
    // Safari is the single most important client this app has.
    expect(cameraCanPhotographAPage({ os: 'web', maxTouchPoints: 5 })).toBe(true);
    expect(cameraCanPhotographAPage({ os: 'web', coarsePointer: true })).toBe(true);
  });

  it('takes a mouse and no touch as a desktop', () => {
    expect(
      cameraCanPhotographAPage({ os: 'web', maxTouchPoints: 0, coarsePointer: false }),
    ).toBe(false);
  });

  it('takes knowing nothing as a desktop', () => {
    // The conservative direction *for this decision*: showing the button is
    // what has to be earned, because the route behind it ends in a refusal
    // every time on a webcam.
    expect(cameraCanPhotographAPage({ os: 'web' })).toBe(false);
  });
});

describe('the direction the guess errs in', () => {
  it('keeps the camera on anything that might be held', () => {
    // A touchscreen laptop keeps a button it does not need. Guessing the other
    // way takes the camera away from a phone, which is the only way most
    // people will ever scan anything.
    expect(
      cameraCanPhotographAPage({ os: 'web', maxTouchPoints: 1, coarsePointer: false }),
    ).toBe(true);
  });
});
