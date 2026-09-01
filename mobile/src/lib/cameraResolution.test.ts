import { describe, expect, it } from 'vitest';

// `?raw` so this reads the patch as text — the project has no `@types/node`,
// so `readFileSync` does not typecheck. Same pattern as `pickerTypes.test.ts`.
import patch from '../../patches/expo-camera+57.0.3.patch?raw';

/**
 * The patch that makes the web camera photograph a page at a readable size.
 *
 * **What it fixes.** `useWebCameraStream` calls `getPreferredStreamDevice`
 * with no width or height, so `getIdealConstraints` fell through to
 * `MinimumConstraints` — `{ audio: false, video: true }`. The browser then
 * chooses, and browsers choose **640x480**. Measured in this repo's own
 * Chromium: `video: true` gives 640x480; an ideal 3840x2160 gives 3840x2160.
 *
 * `captureImage` draws its canvas at exactly `video.videoWidth/videoHeight`, so
 * that 640x480 *is* the photograph the app uploads — whatever the phone's rear
 * camera is capable of, and however sharp the preview looked.
 *
 * **Why that is the whole bug.** 640x480 is precisely what the server refuses:
 * `too_small_to_read` wants 8 source pixels between staff lines and a page of
 * music at 480 rows has roughly 4. So a musician photographing a page through
 * the web build was told the image was too hard to read, and the page they had
 * uploaded really was — not because of their camera, their lighting or their
 * hands, but because the app never asked the camera for its pixels.
 *
 * `cameraCanPhotographAPage` already turned desktops away for the same reason
 * and deliberately kept phone browsers, on the grounds that "its rear camera is
 * the best camera in this product". It was, and the app was throwing it away.
 *
 * **Why a test on a patch file.** A patch is invisible: applied by
 * `postinstall`, outside `src`, imported by nothing. An `npm update` that moves
 * the version leaves it silently unapplied — and the symptom is not a crash but
 * a photograph that is quietly too small, which is the failure mode this
 * project has been bitten by before.
 */
describe('the expo-camera resolution patch', () => {
  it('is still for the version that is installed', async () => {
    const installed = (await import('../../node_modules/expo-camera/package.json'))
      .default.version;

    // `patch-package` only applies a patch whose filename matches the installed
    // version, so a mismatch means it silently did nothing.
    expect(installed).toBe('57.0.3');
    expect(patch).toContain('WebCameraUtils.js');
  });

  it('asks for enough pixels to resolve a staff', () => {
    // The floor is the server's: `too_small_to_read` refuses under 8 source
    // pixels between staff lines. A page has roughly 12 systems of 5 lines, so
    // a request under about 1500 rows cannot clear it whatever the camera is.
    const height = /INTEMPO_IDEAL_HEIGHT = (\d+)/.exec(patch);
    const width = /INTEMPO_IDEAL_WIDTH = (\d+)/.exec(patch);

    expect(width, 'the patch no longer declares an ideal width').not.toBeNull();
    expect(height, 'the patch no longer declares an ideal height').not.toBeNull();
    expect(Number(height![1])).toBeGreaterThanOrEqual(1500);
    expect(Number(width![1])).toBeGreaterThanOrEqual(2000);
  });

  it('asks for an ideal size rather than an exact one', () => {
    // `exact` fails to open the camera at all on a device that cannot reach the
    // size. A page photographed at 1920x1080 is worth having; no camera is not.
    expect(patch).toContain('{ ideal: width }');
    expect(patch).toContain('{ ideal: height }');
    expect(patch).not.toMatch(/\{ exact: (width|height) \}/);
  });

  it('no longer falls through to the constraints that caused this', () => {
    // The removed line is the bug: `MinimumConstraints` is `video: true`, and
    // `video: true` is 640x480.
    expect(patch).toContain('-    if (hasValidConstraints(preferredCameraType, width, height)) {');
    expect(patch).toContain('-        return MinimumConstraints;');
  });
});
