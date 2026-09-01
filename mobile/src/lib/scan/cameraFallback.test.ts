import { describe, expect, it } from 'vitest';

import { cameraFallback } from './cameraFallback';

/**
 * The scanner's answer when it has no viewfinder to show.
 *
 * The property under test is not the wording; it is that **every message that
 * names a way forward comes with the control for it**. The screen this replaces
 * named two routes and offered neither, which is how a refused permission
 * became a dead end with directions on it.
 */
describe('the scanner with no camera', () => {
  it('has nothing to say when the camera works', () => {
    expect(cameraFallback({ granted: true, canAskAgain: false, os: 'web' })).toBeNull();
  });

  it('says "not yet" rather than "no" while the answer is still coming', () => {
    // Half a second of the refusal copy makes a working camera look broken.
    const waiting = cameraFallback({ granted: null, canAskAgain: true, os: 'ios' });
    expect(waiting?.message).toContain('Starting');
    expect(waiting?.action).toBeNull();
  });

  it('offers nothing while the system prompt is still to come', () => {
    // A second decision stacked on the one already on screen.
    const asking = cameraFallback({ granted: false, canAskAgain: true, os: 'ios' });
    expect(asking?.action).toBeNull();
  });

  it('sends a refused browser to the camera app, which needs no such grant', () => {
    const web = cameraFallback({ granted: false, canAskAgain: false, os: 'web' });
    expect(web?.action).toEqual({
      label: 'Open the camera app',
      route: 'systemCamera',
    });
    // Not "device settings": in a browser the permission belongs to the site
    // and there is no settings screen this app can point at.
    expect(web?.message).not.toContain('Settings');
  });

  it('sends a refused app to its own photographs, and names Settings', () => {
    const native = cameraFallback({ granted: false, canAskAgain: false, os: 'ios' });
    expect(native?.action).toEqual({
      label: 'Choose images instead',
      route: 'import',
    });
    expect(native?.message).toContain('Settings');
  });

  it('never names a way forward without the control for it', () => {
    // The rule the old copy broke, asserted across every state.
    const states = [true, false, null].flatMap((granted) =>
      [true, false].flatMap((canAskAgain) =>
        ['web', 'ios', 'android'].map((os) => ({ granted, canAskAgain, os })),
      ),
    );
    for (const state of states) {
      const fallback = cameraFallback(state);
      if (!fallback || fallback.action) {
        continue;
      }
      expect(
        fallback.message,
        `${JSON.stringify(state)} offers a route with no control`,
      ).not.toMatch(/instead|Settings|camera app/);
    }
  });
});
