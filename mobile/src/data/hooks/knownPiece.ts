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

/**
 * Whether the piece screen knows what music it has for a piece: notation, page
 * photographs, or truly neither.
 *
 * **A placeholder with neither cannot tell "none" from "not loaded yet".** The
 * library listing kept on disk (`persistCache.pieceForDisk`) drops every
 * piece's notation and its signed photograph to stay inside the storage
 * budget, so a piece opened from the Library just after launch arrives here
 * with `score` and `thumbnail` both null whatever it really holds. Read as
 * fact, that drew "Add the sheet music to record" with Photograph it and
 * Choose photos over a piece that had both, for as long as the piece's own
 * request took: about a second on a good connection, and the whole cold start
 * on a backend that is waking. Measured against the stub API with that
 * request delayed by three seconds, 2026-10-06.
 *
 * What a placeholder *does* hold is real, because the listing and the detail
 * go through the same mapper: notation or a photograph on it means the piece
 * has them. Only their absence is unknown.
 */
export function knowsItsMusic(piece: Piece, isPlaceholder: boolean): boolean {
  if (!isPlaceholder) {
    return true;
  }
  return (piece.score?.measures.length ?? 0) > 0 || piece.thumbnail !== null;
}
