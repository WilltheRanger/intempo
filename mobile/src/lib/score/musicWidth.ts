/**
 * The width music on full-bleed paper is laid out at, known before layout is.
 *
 * **The music waited for `onLayout` to say how wide it could be, and the page
 * moved when it was told.** Nothing was drawn on the first frame, so "Listen",
 * "Listen from" and the rows under them were laid out about two hundred
 * points higher than where they ended up, and then dropped when the stave
 * arrived: a layout shift of 0.12 on every visit, where 0.1 is the line
 * between good and not (measured 2026-10-06, `/pieces/:id/score`).
 *
 * The paper is full-bleed within the screen's reading measure, so the width is
 * known from the window: the measure, less the paper's own margin each side.
 * The piece screen's opening lines and Tempo's band are the same paper, and
 * moved the same way (0.06 on the piece screen); `ScoreBand` takes `fullBleed`
 * to say so. A Library tile is not full-bleed, and still measures.
 * `onLayout` still has the last word — a scrollbar, or a safe-area inset on a
 * phone held sideways, is corrected on the next frame — but in the ordinary
 * case it agrees, and nothing moves.
 */
export function fullBleedMusicWidth(windowWidth: number, measure: number, margin: number): number {
  return Math.max(0, Math.min(windowWidth, measure) - 2 * margin);
}
