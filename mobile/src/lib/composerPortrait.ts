import type { ThumbnailSource } from '../data/types';
import { canonical } from './composers';

/**
 * A composer's portrait, when the app has one.
 *
 * **Empty, and that is the honest state today.** The owner asked for this —
 * *"some composers are tied to a picture of them selves such as beethoven, so
 * thats the cover"* — and the pictures cannot be fetched from the environment
 * this was written in: Wikimedia Commons is refused by the network policy
 * (403 on CONNECT), and shipping portraits whose provenance I could not check
 * would be worse than shipping none. Every composer here is long dead and
 * their portraits are public domain; sourcing them is a task with a licence
 * audit attached, not a download.
 *
 * So this is the seam, complete and tested, with the table empty. Filling it
 * is a data change: add a file to `assets/composers/`, add a row here with the
 * focal point, and every cover in the app picks it up.
 *
 * ## One image, two crops
 *
 * The request was for *"a good looking one for a sqaure aspect ration and one
 * for that rectangle look when it says continue practicing"* — two shapes.
 * Shipping two files per composer is the obvious answer and the wrong one: two
 * files drift, double the bytes, and a portrait cropped twice by hand is two
 * decisions to get right instead of one.
 *
 * A **focal point** does it with one file. `expo-image`'s `contentPosition`
 * takes a percentage, so a portrait whose face sits a third of the way down
 * keeps that face centred whether the frame is square or a wide banner. That is
 * exactly what a focal point is for, and it is the difference between a
 * portrait and a picture of a forehead.
 */
export interface Portrait {
  source: ThumbnailSource;
  /**
   * Where the subject's face is, as percentages of the image.
   *
   * `50% 30%` is the usual answer for a formal portrait: centred horizontally,
   * high enough that a wide crop keeps the eyes rather than the collar.
   */
  focus: { x: number; y: number };
}

/**
 * Portraits by canonical composer name.
 *
 * Keyed on `Composer.name` rather than on whatever a musician typed, so all the
 * spellings of one person share one picture — which is half the reason
 * `canonical` exists.
 */
export const PORTRAITS: Record<string, Portrait> = {};

/** The portrait for a typed composer name, or null. */
export function portraitFor(composer: string | null | undefined): Portrait | null {
  const known = canonical(composer);
  if (!known) {
    return null;
  }
  return PORTRAITS[known.name] ?? null;
}

/** What a piece's cover should be, in order of how much it says about it. */
export type Cover =
  | { kind: 'page'; source: ThumbnailSource }
  | { kind: 'portrait'; source: ThumbnailSource; focus: { x: number; y: number } }
  | { kind: 'staff' };

/**
 * **The photograph first, always.**
 *
 * A picture of the actual page is what the musician took, of the music they
 * are working on; a portrait of Beethoven is decoration by comparison, however
 * handsome. So the portrait only ever fills a hole — a piece entered by hand,
 * or one whose photograph was discarded on accept — and the ruled staff lines
 * stay as the answer for a piece whose composer nobody named.
 */
export function coverFor(piece: {
  thumbnail: ThumbnailSource | null;
  composer: string | null;
}): Cover {
  if (piece.thumbnail !== null) {
    return { kind: 'page', source: piece.thumbnail };
  }
  const portrait = portraitFor(piece.composer);
  if (portrait) {
    return { kind: 'portrait', source: portrait.source, focus: portrait.focus };
  }
  return { kind: 'staff' };
}
