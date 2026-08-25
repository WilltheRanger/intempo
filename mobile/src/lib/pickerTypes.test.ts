import { describe, expect, it } from 'vitest';

// `?raw` so this reads the patch as text — the project has no `@types/node`,
// so `readFileSync` does not typecheck (see `transcriptionProgress.test.ts`).
import patch from '../../patches/expo-image-picker+57.0.11.patch?raw';

/**
 * The patch that lets a photograph be imported on a desktop browser.
 *
 * **What it fixes.** `expo-image-picker`'s web implementation reads
 * `File.type` and throws when it is empty. A browser leaves it empty whenever
 * the platform has no MIME mapping for the name — a HEIC synced from a phone,
 * an uppercase extension, a file with no extension — so an ordinary JPEG was
 * refused with `Unsupported file type: .` before it was ever looked at. Nothing
 * about the file was wrong.
 *
 * **Why a test on a patch file.** A patch is invisible: it is applied by
 * `postinstall`, it lives outside `src`, and nothing imports it. An
 * `npm update` that moves the version leaves it silently unapplied, and the
 * only symptom is a musician being told their photograph is the wrong sort of
 * file. This makes that visible on the next test run.
 */

/** Every extension the backend will accept for a page — `_ALLOWED_IMAGE_EXTS`. */
const ACCEPTED_BY_THE_SERVER = ['jpg', 'jpeg', 'png', 'heic', 'webp'];

describe('the expo-image-picker web patch', () => {
  it('is still for the version that is installed', async () => {
    // If this fails, the patch did not apply and the picker is unpatched.
    const installed = (
      await import('../../node_modules/expo-image-picker/package.json')
    ).default.version;

    // The filename this test imports carries the version the patch was cut
    // against. `patch-package` only applies a patch whose name matches the
    // installed version, so a mismatch means it silently did nothing.
    expect(installed).toBe('57.0.11');
    expect(patch).toContain('ExponentImagePicker.web.ts');
  });

  it('infers a type for every extension the server would accept', () => {
    // A file the picker refuses never reaches the upload, so a gap here is a
    // page that cannot be imported at all — not one that fails later with a
    // reason.
    for (const extension of ACCEPTED_BY_THE_SERVER) {
      expect(patch, `${extension} is not covered by the patch`).toContain(
        `${extension}: 'image/`,
      );
    }
  });

  it('only fills in a type the browser left empty', () => {
    // The guard that keeps this from overriding a browser that got it right.
    expect(patch).toContain('if (file.type)');
  });

  it('names the file when it genuinely cannot tell', () => {
    // The message the musician actually saw was `Unsupported file type: .`
    // Whatever is left unhandled must at least say which file it means.
    expect(patch).toContain('targetFile.name');
  });
});
