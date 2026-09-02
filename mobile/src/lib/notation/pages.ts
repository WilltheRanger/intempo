/** The vertical extent of one engraved system: `EngravedSystem.top`/`bottom`. */
export interface SystemExtent {
  top: number;
  bottom: number;
}

export interface StavePage {
  /** Index of this page's first system, and one past its last. */
  from: number;
  to: number;
  /** Where the page starts in the drawing, and how much of it the page holds. */
  top: number;
  height: number;
  /**
   * One system, alone, taller than the viewport.
   *
   * It still gets a page — a system is never cut in half — but the caller
   * cannot show all of it at once and may want to let the scroll rest inside
   * this page rather than only at its top.
   */
  overflows: boolean;
}

/**
 * Group engraved systems into pages that fit a viewport.
 *
 * **A page break never falls through a system.** The picker used to be one
 * continuous scroll: finding bar 40 of a concerto meant dragging through the
 * whole piece, and wherever the drag stopped, the top and bottom lines of
 * music were cut through. Pages give a swipe a unit — one page forward, one
 * page back — and a resting position where every visible system is whole.
 *
 * Greedy, because that is what a page of music is: fit what fits, then start
 * a new one. `gutter` is breathing room above a page's first system, taken out
 * of the same viewport so that reserving it can never push a system off the
 * page it was measured onto.
 *
 * A system taller than the viewport still gets a page of its own. Splitting it
 * would produce exactly the cut-through-the-stave this exists to prevent, so
 * the page is simply taller than the window and says so.
 */
export function paginateSystems(
  systems: SystemExtent[],
  viewport: number,
  gutter = 0,
): StavePage[] {
  if (systems.length === 0) {
    return [];
  }

  // Nothing has been measured yet, or the window is nonsense. One page holding
  // everything is the honest answer: it is what the caller was drawing before
  // there was a viewport to break against.
  if (!Number.isFinite(viewport) || viewport <= 0) {
    return [
      {
        from: 0,
        to: systems.length,
        top: Math.max(0, systems[0].top - gutter),
        height: systems[systems.length - 1].bottom - systems[0].top + gutter,
        overflows: true,
      },
    ];
  }

  const pages: StavePage[] = [];
  let from = 0;

  while (from < systems.length) {
    const top = Math.max(0, systems[from].top - gutter);
    let to = from + 1;

    while (to < systems.length && systems[to].bottom - top <= viewport) {
      to += 1;
    }

    const height = systems[to - 1].bottom - top;
    pages.push({ from, to, top, height, overflows: height > viewport });
    from = to;
  }

  return pages;
}

/**
 * Which page a system landed on, or `-1` if the pagination does not hold it.
 *
 * The pages partition the systems in order, so this is a lookup rather than a
 * search — but it is written as one anyway, because a caller passing a system
 * index from a stale layout should get an answer it can check rather than an
 * index into the wrong page.
 */
export function pageOfSystem(pages: StavePage[], system: number): number {
  return pages.findIndex((page) => system >= page.from && system < page.to);
}

/**
 * Which page the scroll is resting on, given how far down it is.
 *
 * The offsets are where each page *view* starts in the scroll, which is not
 * where the page starts in the drawing: a page view is at least a viewport
 * tall even when its music is shorter, so the two coordinate systems drift
 * apart by the slack. The caller owns the stacking, so the caller passes the
 * offsets.
 *
 * The last page whose offset is at or above the scroll: a scroll stopped
 * part-way through a page is still reading that page. A small tolerance,
 * because a snapped offset arrives a fraction of a point off on both platforms
 * and naming the previous page for the last pixel of a swipe is a readout that
 * flickers.
 */
export function pageAtOffset(offsets: number[], scrollY: number): number {
  const TOLERANCE = 1;
  let current = 0;
  for (let index = 0; index < offsets.length; index += 1) {
    if (offsets[index] <= scrollY + TOLERANCE) {
      current = index;
    }
  }
  return current;
}

/**
 * Where each page view starts in the scroll.
 *
 * A page view is never shorter than the viewport — a half-height last page
 * would let the scroll rest with music from two pages on screen, which is the
 * thing pages exist to stop — so the stacking is a running total of those
 * heights rather than of the pages' own.
 */
export function pageOffsets(pages: StavePage[], viewport: number): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const page of pages) {
    offsets.push(cursor);
    cursor += Math.max(viewport, page.height);
  }
  return offsets;
}
