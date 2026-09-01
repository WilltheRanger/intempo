/**
 * What the viewfinder actually showed, as a rectangle in the photograph.
 *
 * **The photograph was not what the musician framed.** The preview is a
 * portrait page window — `ViewfinderPage`, `aspectRatio: 0.74`, close to A4 —
 * and the video fills it with `object-fit: cover`, which crops. The capture
 * takes the *whole* frame. Measured in this repo's own browser: the stream is
 * 3840x2160, the preview box is 296x408, and the saved image is 3840x2160. So
 * a page filling the preview occupies about **41% of the width** of the file,
 * with two and a half times more desk than the musician chose to include.
 *
 * That is not a cosmetic mismatch. `crop_systems` on the server tiles the page
 * and looks for staff systems by ink density; the desk on either side is ink
 * it has to reject, and `_cuts_are_quiet` is trying to find quiet rows in a
 * picture that is mostly not music. And it is why "fill the frame" — the
 * instruction printed under the viewfinder — could be followed exactly and
 * still produce a page the reader treats as small and far away.
 *
 * Cropping does not change staff spacing in pixels, so it is not by itself a
 * resolution fix. What it fixes is the promise: the rectangle you framed is
 * the rectangle that gets read.
 */

export interface Rect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * The region of a `width x height` image that a `boxAspect` window showed
 * under `object-fit: cover`, centred.
 *
 * Returns null when there is nothing to crop — the image already matches the
 * window, or the numbers are unusable. Null rather than a full-size rectangle
 * so a caller can skip a decode-and-re-encode of a large photograph entirely,
 * which on a phone browser is the difference between instant and a stall.
 */
export function visibleRegion(
  width: number,
  height: number,
  boxAspect: number,
): Rect | null {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(boxAspect) ||
    width <= 0 ||
    height <= 0 ||
    boxAspect <= 0
  ) {
    return null;
  }

  const imageAspect = width / height;
  // Within a pixel of the same shape. Cropping here would cost a full re-encode
  // to remove a rounding error.
  if (Math.abs(imageAspect - boxAspect) < 1e-3) {
    return null;
  }

  if (imageAspect > boxAspect) {
    // The image is wider than the window, so the window showed a full-height
    // slice out of the middle.
    const visible = Math.round(height * boxAspect);
    return {
      originX: Math.round((width - visible) / 2),
      originY: 0,
      width: visible,
      height,
    };
  }

  const visible = Math.round(width / boxAspect);
  return {
    originX: 0,
    originY: Math.round((height - visible) / 2),
    width,
    height: visible,
  };
}

/**
 * The viewfinder's own shape, so the crop and the preview cannot disagree.
 *
 * `ViewfinderPage` sets this as a style; it is repeated here because a
 * stylesheet is not importable arithmetic and the two being the same number is
 * the whole guarantee. `ViewfinderPage` imports it back, so there is one
 * literal.
 */
export const PAGE_ASPECT = 0.74;

/**
 * Crop a captured page to what the viewfinder showed.
 *
 * Lazily imports `expo-image-manipulator` for the reason `shrink.ts` does:
 * that package reaches `react-native` at import time, whose Flow syntax vitest
 * cannot parse, so a value import here would make every module that touches
 * the scanner untestable.
 *
 * **Never throws and never returns nothing.** A crop that fails gives back the
 * photograph it was given: a slightly-too-wide page is a page, and losing a
 * capture to an image-processing failure is losing the shot.
 */
export async function cropToViewfinder(
  uri: string,
  width: number,
  height: number,
): Promise<string> {
  const region = visibleRegion(width, height, PAGE_ASPECT);
  if (!region) {
    return uri;
  }
  try {
    const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
    const result = await manipulateAsync(uri, [{ crop: region }], {
      // **JPEG, and near-lossless.** The web capture arrives as a PNG (see
      // `ScannerScreen`), and re-encoding a photograph as PNG here would keep
      // it at ten times the size for no visible gain. 0.95 rather than 1.0
      // because the difference is invisible at the scale a staff line occupies
      // and the file is a third smaller; `shrink.ts` trades further only when
      // something actually has to fit.
      compress: 0.95,
      format: SaveFormat.JPEG,
    });
    return result.uri || uri;
  } catch {
    return uri;
  }
}
