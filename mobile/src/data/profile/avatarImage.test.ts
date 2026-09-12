import { describe, expect, it, vi } from 'vitest';

// `?raw` so this reads the package's declaration as text — the project has no
// `@types/node`, so `readFileSync` does not typecheck, and importing the
// module itself would pull in `react-native`.
import manipulatorTypes from '../../../node_modules/expo-image-manipulator/build/ImageManipulator.types.d.ts?raw';

import {
  AVATAR_MAX_EDGE,
  AVATAR_QUALITY,
  avatarWidthFor,
  prepareAvatar,
} from './avatarImage';

/**
 * A profile picture the size of a profile picture.
 *
 * Measured on the live project before any of this existed: **3.1 MB an
 * avatar**, for a circle drawn at 76 points. The picker was asked for a
 * quality, so an iPhone's HEIC arrived as JPEG and the format was never the
 * problem — nothing touched the resolution, and a 12-megapixel photograph was
 * stored, signed and downloaded to fill a postage stamp.
 */

function manipulator() {
  const calls: unknown[][] = [];
  const fn = vi.fn(async (uri: string, actions?: unknown, options?: unknown) => {
    calls.push([uri, actions, options]);
    return { uri: `${uri}#small`, width: 0, height: 0 };
  });
  return { fn, calls };
}

const sized = (width: number, height: number) => async () => ({ width, height });

describe('avatarWidthFor', () => {
  it('scales the width down from the long edge, not to it', () => {
    // **`resize: { width }` sets the width and derives the height**, in either
    // orientation. A portrait photograph asked for a width of 512 comes back
    // 512x683, whose long edge is 683 — over the bound this file is named
    // after. `lib/scan/shrink.ts` shipped exactly this mistake once, with
    // every comment describing a bound the code was not applying.
    const width = avatarWidthFor({ width: 3024, height: 4032 });

    expect(width).toBe(384);
    // The long edge lands on the bound, which is the whole assertion.
    expect(Math.round(384 * (4032 / 3024))).toBe(AVATAR_MAX_EDGE);
  });

  it('scales a landscape picture the other way round', () => {
    expect(avatarWidthFor({ width: 4032, height: 3024 })).toBe(AVATAR_MAX_EDGE);
  });

  it('leaves a square picture at the bound', () => {
    expect(avatarWidthFor({ width: 1024, height: 1024 })).toBe(AVATAR_MAX_EDGE);
  });

  it('leaves a picture that already fits alone', () => {
    // Enlarging would spend a lossy re-encode to make the file bigger.
    expect(avatarWidthFor({ width: 300, height: 400 })).toBeNull();
    expect(avatarWidthFor({ width: AVATAR_MAX_EDGE, height: 200 })).toBeNull();
  });

  it('treats an unmeasurable picture as one to leave alone', () => {
    expect(avatarWidthFor(null)).toBeNull();
    expect(avatarWidthFor({ width: 0, height: 0 })).toBeNull();
  });
});

describe('prepareAvatar', () => {
  it('re-encodes a camera photograph down to the bound', async () => {
    const m = manipulator();

    const result = await prepareAvatar(
      'file://photo.heic',
      'image/heic',
      sized(3024, 4032),
      m.fn,
    );

    expect(result).toEqual({
      uri: 'file://photo.heic#small',
      mimeType: 'image/jpeg',
      changed: true,
    });
    expect(m.calls[0][1]).toEqual([{ resize: { width: 384 } }]);
    expect(m.calls[0][2]).toMatchObject({ compress: AVATAR_QUALITY, format: 'jpeg' });
  });

  it('leaves a small picture untouched, type and all', async () => {
    const m = manipulator();

    const result = await prepareAvatar(
      'file://tiny.png',
      'image/png',
      sized(200, 200),
      m.fn,
    );

    expect(result).toEqual({
      uri: 'file://tiny.png',
      mimeType: 'image/png',
      changed: false,
    });
    expect(m.fn).not.toHaveBeenCalled();
  });

  it('sends the original when it cannot be measured', async () => {
    const m = manipulator();

    const result = await prepareAvatar(
      'file://photo.jpg',
      'image/jpeg',
      async () => null,
      m.fn,
    );

    expect(result.changed).toBe(false);
    expect(result.uri).toBe('file://photo.jpg');
  });

  it('sends the original when the re-encode fails', async () => {
    // **This is a saving, not a requirement.** Failing the upload to make it
    // would cost somebody their profile picture to save a few hundred
    // kilobytes, which is not a trade.
    const result = await prepareAvatar(
      'file://photo.jpg',
      'image/jpeg',
      sized(3024, 4032),
      vi.fn(async () => {
        throw new Error('no manipulator here');
      }),
    );

    expect(result).toEqual({
      uri: 'file://photo.jpg',
      mimeType: 'image/jpeg',
      changed: false,
    });
  });

  it('says JPEG once it has re-encoded, whatever came in', async () => {
    // The extension the object is filed under follows this, and the server
    // refuses HEIC for an avatar because the picture is handed straight to an
    // `<img>`. Reporting the original type after converting would file a JPEG
    // as `avatar.heic`.
    const m = manipulator();

    const result = await prepareAvatar(
      'file://photo.heic',
      'image/heic',
      sized(4032, 3024),
      m.fn,
    );

    expect(result.mimeType).toBe('image/jpeg');
  });
});

describe("the format literal, against the package's own enum", () => {
  it("is still what SaveFormat.JPEG means", () => {
    // **Read off the package, not off a mock.** `shrink.test.ts` claims to pin
    // its identical literal and does not: it mocks `SaveFormat: { JPEG:
    // 'jpeg' }` and then compares against the mock, which agrees with itself
    // no matter what the package says. Importing the real module here would
    // pull in `react-native`, whose Flow syntax vitest cannot parse — so the
    // declaration is read as text, which is the one way to ask the package
    // without loading it.
    expect(manipulatorTypes).toMatch(/JPEG\s*=\s*"jpeg"/);
  });
});
