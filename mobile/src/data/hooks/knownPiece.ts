import type { Piece } from '../types';

/**
 * The piece as the app already knows it, from a list it has already loaded.
 *
 * **Pure, and separate from the hook, so it can be tested.** It decides what a
 * screen shows in the moment before its own request answers, which is the part
 * a musician actually experiences and the part nothing here was checking.
 *
 * The library listing and the detail endpoint go through the same `toPiece`
 * mapper, so every field this returns is the real value rather than a guess —
 * the listing is *thinner*, not different. `pages` carries page one alone and
 * `score` may be absent, which is why the piece screen guards everything
 * derived from them: a placeholder makes the screen say **less**, never
 * something untrue.
 */
export function pieceFromCaches(
  id: string,
  list: Piece[] | undefined,
  current: Piece | null | undefined,
): Piece | undefined {
  const listed = list?.find((piece) => piece.id === id);
  if (listed) {
    return listed;
  }
  // Today leads with a piece that is not necessarily in a loaded library page.
  return current && current.id === id ? current : undefined;
}
