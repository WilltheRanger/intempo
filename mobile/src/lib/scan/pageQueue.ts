import type { CapturedPage } from '../../data/captureSession';

/**
 * What the review list says about the pages waiting to be sent.
 *
 * **The queue states each page's condition before anything is uploaded.** The
 * scanner measures every photograph it takes and the finding used to live and
 * die on that screen, so a page the app had already decided it could not read
 * went into the queue looking exactly like the eleven beside it, and the
 * musician found out after the upload, the wait and the transcription.
 *
 * `CLAUDE.md` §3: a rule inside a `.tsx` is a rule nothing checks, and "does
 * this warn when it should" is the kind that stays wrong quietly.
 */

/**
 * The one-line note under a page's number, or nothing.
 *
 * **Only pages worth another look get one.** Twelve rows each saying "the notes
 * are clear" is the element §3 law 10 asks to remove, and it would bury the one
 * row that is not. This is the opposite of the call the viewfinder makes, and
 * deliberately: right after the shutter there is no other signal, so silence
 * there reads as nothing having happened. Here every page is visibly in the
 * list already, and a row with no note is a row with nothing to say.
 *
 * A page with no reading at all — everything that arrived through Import, which
 * is never measured — is also silent. Inventing a condition for a page nothing
 * looked at would be the app stating a finding it does not have.
 */
export function pageNote(page: CapturedPage): string | null {
  return page.reading && page.reading.tone === 'doubtful'
    ? page.reading.headline
    : null;
}

/** How many pages in this scan came back doubtful. */
export function doubtfulCount(pages: CapturedPage[]): number {
  return pages.filter((page) => pageNote(page) !== null).length;
}

/**
 * The line under the heading: what happens to these pages, and any caveat.
 *
 * The order sentence is the promise this screen makes and the reason the rows
 * can be dragged at all. The caveat is second and only appears when it is true,
 * because a warning that is always on screen is a warning nobody reads.
 */
export function queueSummary(pages: CapturedPage[]): string {
  const order =
    pages.length === 1
      ? 'This page will be read.'
      : 'Pages are read in this order.';

  const doubtful = doubtfulCount(pages);
  if (doubtful === 0) {
    return order;
  }
  // Named by what to do about it. "1 page failed a legibility check" describes
  // the app's own process; "worth another look" is the musician's next move,
  // and the rows say which pages.
  const which =
    doubtful === 1 ? 'One page is' : `${doubtful} pages are`;
  return `${order} ${which} worth another look before you send.`;
}
