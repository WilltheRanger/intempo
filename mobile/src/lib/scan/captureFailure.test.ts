import { describe, expect, it } from 'vitest';

import { captureFailure } from './captureFailure';

/**
 * The copy on the one screen a musician reaches by pressing a button that did
 * nothing. Every assertion here is a promise the screen makes about itself.
 */
describe('captureFailure', () => {
  const failure = captureFailure();

  /**
   * Asked for directly, and the rest of the app writes with em dashes, so
   * nothing else in the repository would have caught it coming back.
   */
  it('uses no em or en dashes', () => {
    const copy = [failure.headline, failure.body, failure.hint].join(' ');
    expect(copy).not.toMatch(/[–—]/);
  });

  /**
   * The route out must not be the thing that just failed. "Try again" on its
   * own is the dead end this screen replaced; the camera app needs no stream
   * from this page at all.
   */
  it('offers a way round as well as a way back', () => {
    expect(failure.retakeLabel).not.toBe(failure.cameraAppLabel);
    expect(failure.cameraAppLabel.toLowerCase()).toContain('camera app');
  });

  /**
   * It says what happened before it says it is fine. A reassurance with no
   * finding in front of it reads as the app not knowing either.
   */
  it('states the finding before the reassurance', () => {
    expect(failure.body.indexOf('gave nothing back')).toBeLessThan(
      failure.body.indexOf('Try again'),
    );
  });

  /** Nothing here blames the person holding the camera. */
  it('does not blame the musician', () => {
    const copy = [failure.headline, failure.body, failure.hint].join(' ');
    expect(copy).not.toMatch(/\byou (did|must|should|need to)\b/i);
  });
});
