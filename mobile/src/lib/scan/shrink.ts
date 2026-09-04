// **Type-only, and loaded lazily below.** `expo-image-manipulator` reaches
// `react-native` at import time, whose Flow syntax vitest cannot parse — so a
// value import here would break every test that merely imports `uploadPage`,
// which is most of the upload suite. Nothing needs it until a page is actually
// too large.
import type { manipulateAsync } from 'expo-image-manipulator';

/**
 * Making a photograph small enough to send without making it too small to read.
 *
 * **The refusal this replaces.** A page chosen from a laptop was 14.8 MB
 * against a 10 MB limit, and the app simply refused it — with advice to
 * "photograph the page with this app's camera instead", which on a desktop
 * means a webcam, and a webcam capture of a page is precisely what
 * `too_small_to_read` exists to turn away. The suggestion could not have
 * worked, and there was no camera roll to compare it to either.
 *
 * Nothing was wrong with the photograph. It was a good page in a large file.
 *
 * ## Quality first, pixels last
 *
 * A JPEG re-encoded at 0.8 is a fraction of the size and visually identical at
 * the scale a staff line occupies. Resolution is the thing the reader actually
 * needs — `staff_space_px` refuses a page whose staff lines are under eight
 * pixels apart — so every quality step is tried at full size before a single
 * pixel is given up.
 */

export interface ShrinkAttempt {
  /**
   * Longest edge in pixels, or null to leave the size alone.
   *
   * **The longest edge, not the width, and that is a correction.** Until
   * 2026-09-04 the number went straight into `resize: { width }`, which
   * `expo-image-manipulator` documents as *"values correspond to the result
   * image dimensions"* — it sets the width to exactly that and derives the
   * height from the ratio, in either direction. Sheet music is photographed
   * portrait, so the resulting long edge was the rung times the aspect ratio:
   * a 4284x5712 page asked for 2400 came back 2400x3200. Every word in this
   * file, `MIN_LONG_EDGE` included, described a bound that was not being
   * applied, and the docstring below computed its own worked example from the
   * long edge — the arithmetic was right and the code was not.
   */
  maxEdge: number | null;
  /** JPEG quality, 0..1. */
  quality: number;
}

/**
 * The smallest long edge this will reduce a page to.
 *
 * Measured against the page that provoked this: 5712 px on its long edge with
 * staff lines 25 px apart, so at 2400 they are about 10.5 — still clear of the
 * server's floor of 8. A denser page starts finer and could cross it, and that
 * is deliberate: the server measures the staff spacing and says so in a
 * sentence about *this* page, which is a far better answer than refusing to
 * send anything at all.
 *
 * That 10.5 is what the bound now actually produces. While the rung was going
 * into `resize: { width }` the same page came back at 3200 on its long edge
 * and about 14 px of spacing — more generous than intended, and reached by
 * accident, which is why it could not be relied on: on a *landscape* page the
 * width is the long edge and the same code was as aggressive as it looks.
 * Orientation decided how hard a page was shrunk, and nothing said so.
 */
export const MIN_LONG_EDGE = 2400;

/**
 * `SaveFormat.JPEG`, as its value.
 *
 * A PNG re-encoded as PNG saves almost nothing, and a 14 MB screenshot of a
 * page is the other way to arrive here. `shrink.test.ts` pins this against the
 * package's own enum so a rename cannot pass silently.
 */
const JPEG = 'jpeg' as Parameters<typeof manipulateAsync>[2] extends
  | { format?: infer F }
  | undefined
  ? NonNullable<F>
  : never;

/**
 * What to try, in order, until it fits.
 *
 * Ordered by what it costs the reading: quality is nearly free, pixels are not.
 * A page that needs the last rung has been reduced to a quarter of its edge and
 * is the one most likely to come back as "too small to read" — which is the
 * right outcome, arrived at with a reason.
 */
export const SHRINK_LADDER: readonly ShrinkAttempt[] = [
  { maxEdge: null, quality: 0.9 },
  { maxEdge: null, quality: 0.8 },
  { maxEdge: null, quality: 0.65 },
  { maxEdge: 4000, quality: 0.8 },
  { maxEdge: 3000, quality: 0.8 },
  { maxEdge: MIN_LONG_EDGE, quality: 0.8 },
];

/** A page already small enough is never re-encoded — see `shrinkToFit`. */
export function needsShrinking(size: number, limit: number): boolean {
  return size > limit;
}

/** What `manipulateAsync` reports back about the image it just wrote. */
export interface PageSize {
  width: number;
  height: number;
}

/**
 * The width to ask for so this page's *long* edge lands on `maxEdge`, or null.
 *
 * Null means do not resize at all, and it covers the two cases that must not
 * turn into a resize call:
 *
 * - **The dimensions are unknown.** Without them there is no way to tell which
 *   edge is long, and guessing is how the bound came to depend on orientation
 *   in the first place.
 * - **The page is already inside the rung.** `resize` sets the dimension it is
 *   given, so a 2480-wide scan handed a rung of 4000 comes back *enlarged* to
 *   4000 across — a bigger file, from a step whose entire purpose is a smaller
 *   one, and then the same again at 3000. The page that reaches the pixel
 *   rungs is by definition one that would not fit; sending it back up is the
 *   worst available move.
 */
export function widthFor(page: PageSize | null, maxEdge: number): number | null {
  if (!page || page.width <= 0 || page.height <= 0) {
    return null;
  }
  const longEdge = Math.max(page.width, page.height);
  if (longEdge <= maxEdge) {
    return null;
  }
  return Math.max(1, Math.round((page.width * maxEdge) / longEdge));
}

export interface Shrunk {
  uri: string;
  size: number;
  /** False when the original was already small enough and was left alone. */
  changed: boolean;
}

/**
 * Re-encode `uri` until it is at or under `limit`, or give up.
 *
 * Returns the original untouched when it already fits — **identity, not an
 * equivalent copy**. Re-encoding a page that did not need it costs detail for
 * nothing, and a lossy round trip is not free just because the file got no
 * bigger.
 *
 * `measure` is injected so the ladder can be tested without a browser: it
 * answers how many bytes a URI holds.
 */
export async function shrinkToFit(
  uri: string,
  size: number,
  limit: number,
  measure: (uri: string) => Promise<number>,
  manipulate?: typeof manipulateAsync,
): Promise<Shrunk> {
  if (!needsShrinking(size, limit)) {
    return { uri, size, changed: false };
  }

  const encode =
    manipulate ?? (await import('expo-image-manipulator')).manipulateAsync;

  let best: Shrunk | null = null;
  // The page's own dimensions, learned once from the first attempt that
  // reports them — which is a full-size one, because the ladder opens with
  // quality-only rungs and a pixel rung with nothing to scale from is skipped.
  // Every rung re-encodes the *original* `uri`, so the page never changes
  // underneath; reading the dimensions again off a resized result would only
  // fold that result's rounding into every rung after it.
  let page: PageSize | null = null;

  for (const attempt of SHRINK_LADDER) {
    const width = attempt.maxEdge === null ? null : widthFor(page, attempt.maxEdge);
    if (attempt.maxEdge !== null && width === null) {
      // Nothing to scale from, or the page is already inside this rung.
      // Skipping is the only safe answer: `resize` enlarges as readily as it
      // shrinks, and a rung that made the file bigger would spend a full
      // re-encode to move away from fitting.
      continue;
    }
    const actions = width === null ? [] : [{ resize: { width } }];
    const result = await encode(uri, actions, {
      compress: attempt.quality,
      // The literal rather than `SaveFormat.JPEG`, which would need the module
      // at import time — see the note on the import above. Pinned by a test.
      format: JPEG,
    });
    if (page === null && result.width > 0 && result.height > 0) {
      page = { width: result.width, height: result.height };
    }
    const shrunk = await measure(result.uri);
    best = { uri: result.uri, size: shrunk, changed: true };
    if (shrunk <= limit) {
      return best;
    }
  }
  // Every rung tried and still too large. The caller reports it; handing back
  // the smallest attempt rather than the original means the message names the
  // size that is actually the problem.
  return best ?? { uri, size, changed: false };
}
