// **Type-only, and loaded lazily below.** `expo-image-manipulator` reaches
// `react-native` at import time, whose Flow syntax vitest cannot parse — so a
// value import here would break every test that merely imports this module.
// Same arrangement, and the same reason, as `lib/scan/shrink.ts`.
import type { manipulateAsync } from 'expo-image-manipulator';

/**
 * Making a profile picture the size of a profile picture.
 *
 * **Measured on the live project: 3.1 MB per avatar**, for a circle drawn at
 * 76 points. `expo-image-picker` is asked for a quality, which re-encodes the
 * HEIC an iPhone shoots into JPEG — so the format was right and nothing ever
 * touched the resolution. A 12-megapixel photograph was being stored, signed
 * and downloaded to fill a space smaller than a postage stamp.
 *
 * At a thousand accounts that is 3 GB, against a free tier of 1 GB, for pixels
 * no screen has ever displayed.
 *
 * **Unconditional, unlike `shrinkToFit`.** That one is a ladder that stops as
 * soon as a page is under a size limit, because a page's resolution is what
 * the reader needs and every pixel given up costs legibility. An avatar has
 * the opposite shape: there is a size it should be, it is small, and a picture
 * already at or below it is left alone rather than re-encoded — a lossy round
 * trip is not free just because the file got no bigger.
 */

/**
 * The longest edge an avatar is stored at.
 *
 * The largest one drawn is 76 points, on Profile. At a 3x device that is 228
 * physical pixels, so 512 is more than double what any screen asks for today
 * and leaves room for a larger treatment without another migration of
 * everybody's picture. At JPEG 0.8 it lands around 40–60 KB — roughly **fifty
 * times** smaller than what is being stored now.
 */
export const AVATAR_MAX_EDGE = 512;

/**
 * JPEG quality for the stored picture.
 *
 * The same 0.8 the page ladder settles on. At 512 px a face is well inside
 * what that quality holds, and the artefacts JPEG shows first — ringing around
 * hard edges — are not what a photograph of a person is made of.
 */
export const AVATAR_QUALITY = 0.8;

/**
 * `SaveFormat.JPEG`, as its value.
 *
 * The literal rather than the enum member, which would need the module at
 * import time — see the note on the import above. `avatarImage.test.ts` reads
 * the declaration out of the package's own `.d.ts` so a rename cannot pass
 * silently; `shrink.ts` says the same thing of its identical literal and its
 * test compares against a mock that agrees with itself.
 */
const JPEG = 'jpeg' as Parameters<typeof manipulateAsync>[2] extends
  | { format?: infer F }
  | undefined
  ? NonNullable<F>
  : never;

export interface PreparedAvatar {
  uri: string;
  /** JPEG whenever this re-encoded; the original type when it did not. */
  mimeType: string;
  /** False when the picture was already small enough and was left untouched. */
  changed: boolean;
}

/**
 * The dimensions a resize should ask for, or null to leave the picture alone.
 *
 * **`resize: { width }` sets the width and derives the height**, in either
 * orientation — which is why this cannot simply pass `AVATAR_MAX_EDGE`. A
 * portrait photograph asked for a width of 512 comes back 512x683, whose long
 * edge is 683. The long edge is the bound, so the width has to be scaled down
 * from it. That exact mistake shipped once in `lib/scan/shrink.ts`, where
 * every comment described a bound the code was not applying.
 *
 * Null when it already fits: enlarging a small picture would cost a re-encode
 * to make the file bigger.
 */
export function avatarWidthFor(
  size: { width: number; height: number } | null,
): number | null {
  if (!size || size.width <= 0 || size.height <= 0) {
    return null;
  }
  const longest = Math.max(size.width, size.height);
  if (longest <= AVATAR_MAX_EDGE) {
    return null;
  }
  return Math.max(1, Math.round(size.width * (AVATAR_MAX_EDGE / longest)));
}

/**
 * A picture's dimensions, without importing `react-native` at module scope.
 *
 * `Image.getSize` is the one measurement that costs nothing — it reads the
 * header rather than decoding the picture, and works the same on the web
 * build. The lazy import is the same arrangement as the manipulator above and
 * for the same reason: a value import of `react-native` at the top of this
 * file makes it unparseable by vitest, and this module is where the rule that
 * needs testing lives.
 */
async function measureImage(
  uri: string,
): Promise<{ width: number; height: number } | null> {
  const { Image } = await import('react-native');
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve(null),
    );
  });
}

/**
 * Re-encode a chosen picture down to avatar size.
 *
 * `measure` and `manipulate` default to the real ones and are injected by the
 * tests, so the rule can be checked without a device. Returns the original
 * untouched when it is already small enough.
 *
 * **Never throws.** A picture that cannot be measured or re-encoded is sent as
 * it is: this is a saving, and failing the upload to make it would cost
 * somebody their profile picture to save a few hundred kilobytes.
 */
export async function prepareAvatar(
  uri: string,
  mimeType: string,
  measure: (uri: string) => Promise<{ width: number; height: number } | null> = measureImage,
  manipulate?: typeof manipulateAsync,
): Promise<PreparedAvatar> {
  const untouched: PreparedAvatar = { uri, mimeType, changed: false };
  try {
    const width = avatarWidthFor(await measure(uri));
    if (width === null) {
      return untouched;
    }
    const encode =
      manipulate ?? (await import('expo-image-manipulator')).manipulateAsync;
    const result = await encode(uri, [{ resize: { width } }], {
      compress: AVATAR_QUALITY,
      format: JPEG,
    });
    return { uri: result.uri, mimeType: 'image/jpeg', changed: true };
  } catch {
    return untouched;
  }
}
