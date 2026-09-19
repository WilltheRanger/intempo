/**
 * Renamed from `heldTake.test.ts`, which is all this commit does to it.
 *
 * The old name read as covering `heldTake.ts`. It never did — every assertion
 * here imports `./heldTake.web`, and the native module has no test of its own.
 * That is correct rather than a gap: native `heldTake.ts` returns null and
 * does nothing on purpose, because the take is a `Blob` and `expo-audio`'s
 * native source resolves file paths, so a URL made there would draw a play
 * control that does nothing — the affordance §3 forbids outright. Its own
 * docstring says so.
 *
 * But a file called `heldTake.test.ts` that tests only the web half makes that
 * deliberate emptiness look like coverage. `session.web.test.ts` and
 * `context.web.test.ts` already name themselves honestly; this one now does
 * too, and the absence of a `heldTake.test.ts` beside them is the thing a
 * reader should notice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { heldTakeUrl, releaseHeldTake } from './heldTake.web';

/**
 * The one step between a take the app is holding and a player that can open it.
 *
 * The control this feeds exists to prove "your take is safe on this device", so
 * the failure that matters is a button that appears and does nothing — which is
 * what returning a broken source would produce.
 */
const original = {
  create: URL.createObjectURL,
  revoke: URL.revokeObjectURL,
};

afterEach(() => {
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
});

describe('heldTakeUrl', () => {
  it('hands back something a player can open', () => {
    URL.createObjectURL = vi.fn(() => 'blob:held');
    expect(heldTakeUrl(new Blob(['x']))).toBe('blob:held');
  });

  /**
   * Null, not a placeholder. The caller draws no control at all rather than
   * one that does nothing when pressed — on a native build the recording would
   * first have to be written to a file, which is different work.
   */
  it('says nothing can be made where the API is absent', () => {
    // @ts-expect-error — modelling a platform without it.
    URL.createObjectURL = undefined;
    expect(heldTakeUrl(new Blob(['x']))).toBeNull();
  });

  it('says nothing can be made when the platform refuses the blob', () => {
    URL.createObjectURL = vi.fn(() => {
      throw new Error('not supported');
    });
    expect(heldTakeUrl(new Blob(['x']))).toBeNull();
  });
});

describe('releaseHeldTake', () => {
  /**
   * An object URL pins the whole blob for the life of the document, and a take
   * is minutes of audio.
   */
  it('lets the bytes go', () => {
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    releaseHeldTake('blob:held');
    expect(revoke).toHaveBeenCalledWith('blob:held');
  });

  it('is safe with nothing to release, and safe twice', () => {
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    releaseHeldTake(null);
    expect(revoke).not.toHaveBeenCalled();
    releaseHeldTake('blob:held');
    releaseHeldTake('blob:held');
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
