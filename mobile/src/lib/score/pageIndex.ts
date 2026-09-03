/**
 * Which page a horizontally paged view is showing.
 *
 * A few lines of arithmetic, and it lives here rather than in the `.tsx` for
 * the reason `DECISIONS.md` gives on 2026-08-24: there is no React Native
 * testing library in this project, so a rule inside a component is a rule
 * nothing checks. Eight of the nine findings in the capture-path audit were
 * rules inside `.tsx` files.
 */

/**
 * The page under the viewport, from a scroll offset.
 *
 * Rounds rather than truncates: a paging scroll view settles within a pixel or
 * two of a page boundary, and truncating reports the *previous* page for every
 * offset that lands a hair short — so the label would say "Page 1 of 3" while
 * page 2 fills the screen.
 *
 * Clamped, because both ends overscroll: iOS bounces past the last page and a
 * trackpad can push the offset negative, and a caption reading "Page 0 of 3"
 * is worse than one that simply stops moving.
 */
export function pageAtOffset(
  offsetX: number,
  pageWidth: number,
  pageCount: number,
): number {
  if (pageCount <= 0) {
    return 0;
  }
  // A width of zero is the first frame, before layout has measured anything.
  // Dividing by it gives Infinity, and `Math.round(Infinity)` is not an index.
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) {
    return 0;
  }
  const page = Math.round(offsetX / pageWidth);
  return Math.min(Math.max(page, 0), pageCount - 1);
}

/** "Page 2 of 3", or null for a scan with nothing to page through. */
export function describePagePosition(
  index: number,
  pageCount: number,
): string | null {
  // **Silent for a one-page scan**, which is most of them. A caption reading
  // "Page 1 of 1" is a label that never changes, occupying space under the
  // photograph to tell a musician nothing (§3 law 10).
  if (pageCount <= 1) {
    return null;
  }
  return `Page ${Math.min(Math.max(index, 0), pageCount - 1) + 1} of ${pageCount}`;
}
