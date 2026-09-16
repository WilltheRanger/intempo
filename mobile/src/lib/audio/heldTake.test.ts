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
