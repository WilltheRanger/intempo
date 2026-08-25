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
  /** Longest edge in pixels, or null to leave the size alone. */
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
  for (const attempt of SHRINK_LADDER) {
    const actions = attempt.maxEdge
      ? [{ resize: { width: attempt.maxEdge } }]
      : [];
    const result = await encode(uri, actions, {
      compress: attempt.quality,
      // The literal rather than `SaveFormat.JPEG`, which would need the module
      // at import time — see the note on the import above. Pinned by a test.
      format: JPEG,
    });
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
