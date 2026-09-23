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
    expect(waiting?.actions).toEqual([]);
  });

  it('offers nothing while the system prompt is still to come', () => {
    // A second decision stacked on the one already on screen.
    const asking = cameraFallback({ granted: false, canAskAgain: true, os: 'ios' });
    expect(asking?.actions).toEqual([]);
  });

  it('sends a refused browser to the camera app, which needs no such grant', () => {
    const web = cameraFallback({ granted: false, canAskAgain: false, os: 'web' });
    expect(web?.actions).toEqual([
      { label: 'Open the camera app', route: 'systemCamera' },
    ]);
    // Not "device settings": in a browser the permission belongs to the site
    // and there is no settings screen this app can point at.
    expect(web?.message).not.toContain('Settings');
    // And no button pretending otherwise. Site controls live in browser
    // chrome, which no page can open.
    expect(web?.actions.map((a) => a.route)).not.toContain('settings');
  });

  it('offers a refused app both the cure and the workaround', () => {
    // **The cure first.** Somebody who came here to photograph a page wants
    // the camera back; the import is the consolation, not the suggestion.
    const native = cameraFallback({ granted: false, canAskAgain: false, os: 'ios' });
    expect(native?.actions).toEqual([
      { label: 'Open Settings', route: 'settings' },
      { label: 'Choose photos', route: 'import' },
    ]);
    expect(native?.message).toContain('Settings');
  });

  const EVERY_STATE = [true, false, null].flatMap((granted) =>
    [true, false].flatMap((canAskAgain) =>
      ['web', 'ios', 'android'].map((os) => ({ granted, canAskAgain, os })),
    ),
  );

  it('never names a way forward without the control for it', () => {
    // The rule the old copy broke, asserted across every state.
    for (const state of EVERY_STATE) {
      const fallback = cameraFallback(state);
      if (!fallback || fallback.actions.length > 0) {
        continue;
      }
      expect(
        fallback.message,
        `${JSON.stringify(state)} offers a route with no control`,
      ).not.toMatch(/instead|Settings|camera app/);
    }
  });

  it('names Settings only where a control can open Settings', () => {
    // **The half of the rule the loop above could not see.** It skipped any
    // state that offered *a* control, so a message naming Settings while
    // handing over an image picker passed — which is exactly what shipped.
    // The route has to match the sentence, not merely exist.
    for (const state of EVERY_STATE) {
      const fallback = cameraFallback(state);
      if (!fallback || !/Settings/.test(fallback.message)) {
        continue;
      }
      expect(
        fallback.actions.map((a) => a.route),
        `${JSON.stringify(state)} names Settings with no way to open it`,
      ).toContain('settings');
    }
  });
});
