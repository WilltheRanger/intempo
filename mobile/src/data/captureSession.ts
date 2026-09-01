import { useSyncExternalStore } from 'react';



/**
 * Where a captured page's pixels live: a local file/blob URI, or a bundled
 * asset in fixtures. Deliberately narrower than `ThumbnailSource`, which also
 * admits a signed-URL-with-cache-key shape a capture can never be — the page
 * has not been uploaded yet, so there is nothing to sign.
 */
export type CapturedSource = string | number;

export interface CapturedPage {
  id: string;
  source: CapturedSource;
}

/** What became of an image the session was handed. */
export type CaptureOutcome = 'added' | 'replaced' | 'full';

/**
 * Maximum pages the backend accepts for one scan.
 *
 * Shared by the camera and image picker so the app refuses page 13 before it
 * photographs or uploads anything. The server enforces the same ceiling.
 */
export const MAX_SCAN_PAGES = 12;

/**
 * The pages captured in the current scan, shared between the scanner and the
 * review screen.
 *
 * Deliberately not route params: reordering and deleting have to survive the
 * round trip when someone goes back to add another page, and params would
 * reset that. Module-level rather than a provider because a capture session is
 * genuinely global — there is only ever one in flight.
 *
 * **Where a photograph goes is decided here, not by the screen that took it.**
 * The viewfinder used to call `add`, unconditionally, which is what made
 * "retake" a lie: the review screen deleted the page first and the shutter
 * appended the replacement to the end, so retaking page 1 of a four-page scan
 * left the new page 1 sitting at position 4 and silently promoted page 2. The
 * upload sends `pages[0]`, so the app then transcribed a page the musician had
 * not chosen while the page they had just carefully re-shot was never sent.
 * `capture` exists so that decision has one home and can be tested.
 */
let pages: CapturedPage[] = [];
let nextId = 1;
/** Durable object keys set by upload, consumed by save in the same page order. */
let uploadedImageKeys: string[] = [];
/** Existing manual piece these pages should be read into, rather than duplicated. */
let attachmentPieceId: string | null = null;
/**
 * The page a retake is going to replace, while one is in flight.
 *
 * A retake is a *pending swap*, not a delete followed by a capture. Deleting
 * first is how a page could be lost with nothing replacing it: close the
 * viewfinder, or have the shutter fail — `takePictureAsync` can return no
 * image — and the photograph was gone with no warning and no undo, on a screen
 * whose own delete button asks for confirmation first.
 */
let retakingId: string | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function commit(next: CapturedPage[]): void {
  const changed =
    next.length !== pages.length ||
    next.some(
      (page, index) =>
        page.id !== pages[index]?.id || page.source !== pages[index]?.source,
    );

  // Uploaded keys describe the exact pixels in the exact order that existed
  // when the transfer ran. A retake, reorder, addition or removal makes that
  // snapshot stale even when the number of pages is unchanged. Keeping it
  // would let Save attach the old photograph or old page order while the
  // review screen shows the edited one.
  if (changed) {
    uploadedImageKeys = [];
  }

  pages = next;
  notify();
}

/**
 * Exported because it is the seam worth testing.
 *
 * `useCapturedPages` is the only consumer in the app, but *how often* the
 * store publishes is a real property: importing used to reset and then append
 * a page at a time, so every subscriber saw the session empty before it saw
 * the pages, and a review screen rendered its own empty state on the way in.
 */
export function subscribeToCaptureSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): CapturedPage[] {
  return pages;
}

/** Subscribes a component to the current capture session. */
export function useCapturedPages(): CapturedPage[] {
  return useSyncExternalStore(subscribeToCaptureSession, getSnapshot, getSnapshot);
}

/**
 * Whether this session has ever held a page.
 *
 * An empty session has two meanings and the screens that render it say
 * different things: a scan whose pages were all removed ("you've removed every
 * page") and one that never had any — which is what a refresh or a deep link to
 * `/scan/pages` produces, and which the routing deliberately allows. Telling
 * someone they removed pages they never took is a small lie about their own
 * actions, which is the kind that is most disorienting.
 *
 * Not derivable from `pages`: both cases are the empty array.
 */
let everHeldPages = false;

export const captureSession = {
  /** Clears the session, retake included. Called when the scanner opens fresh. */
  reset(options: { attachToPieceId?: string } = {}): void {
    nextId = 1;
    uploadedImageKeys = [];
    attachmentPieceId = options.attachToPieceId ?? null;
    retakingId = null;
    everHeldPages = false;
    commit([]);
  },

  /**
   * Takes an image from the viewfinder and puts it where it belongs.
   *
   * The only way a captured photograph enters the session, and the reason
   * `add` is not exported: a shutter that can append is a shutter that can
   * append *past a pending retake*, which is the bug this replaced.
   *
   * Returns what it did, because the two outcomes mean different things to the
   * screen — a retake is one shot and you are finished, an ordinary capture
   * leaves you at the viewfinder for the next page.
   */
  capture(source: CapturedSource): CaptureOutcome {
    const target = retakingId;
    retakingId = null;

    if (target !== null && pages.some((page) => page.id === target)) {
      everHeldPages = true;
      commit(pages.map((page) => (page.id === target ? { ...page, source } : page)));
      return 'replaced';
    }

    // The page being retaken is no longer in the session — deleted from
    // another screen, or a session reset underneath. Append rather than drop
    // while there is room. The camera checks this before taking a photograph;
    // the guard here keeps programmatic callers from creating a scan the API
    // will refuse after every page has already uploaded.
    if (pages.length >= MAX_SCAN_PAGES) {
      return 'full';
    }
    everHeldPages = true;
    commit([...pages, { id: `page-${nextId++}`, source }]);
    return 'added';
  },

  /**
   * Replaces the whole session with pages chosen from the photo library.
   *
   * Importing is starting a new piece, not adding to whatever was photographed
   * earlier, so this resets — but in one commit rather than a reset followed by
   * a loop of appends, which published an empty list to every subscriber first.
   */
  importAll(
    sources: CapturedSource[],
    options: { attachToPieceId?: string } = {},
  ): void {
    if (sources.length > MAX_SCAN_PAGES) {
      throw new Error(
        `A score can have at most ${MAX_SCAN_PAGES} pages in one scan.`,
      );
    }
    nextId = 1;
    uploadedImageKeys = [];
    attachmentPieceId = options.attachToPieceId ?? null;
    retakingId = null;
    // A replacement, not an addition: this resets the session above.
    everHeldPages = sources.length > 0;
    commit(sources.map((source) => ({ id: `page-${nextId++}`, source })));
  },

  /**
   * Marks which page the next capture replaces.
   *
   * Nothing is removed here. Whatever happens next — a photograph, a closed
   * viewfinder, a failed shutter, a phone call — the page it names is still in
   * the session until something actually replaces it.
   */
  beginRetake(id: string): void {
    retakingId = id;
    notify();
  },

  /** Abandons a pending retake, leaving the page it named untouched. */
  cancelRetake(): void {
    retakingId = null;
    notify();
  },

  retaking(): string | null {
    return retakingId;
  },

  remove(id: string): void {
    commit(pages.filter((page) => page.id !== id));
  },

  /** Swaps a page with its neighbour. Out-of-range moves are ignored. */
  move(id: string, direction: -1 | 1): void {
    const index = pages.findIndex((page) => page.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= pages.length) {
      return;
    }
    const next = [...pages];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  },

  /** Moves a page to an absolute index. Used by drag-to-reorder. */
  moveTo(id: string, index: number): void {
    const from = pages.findIndex((page) => page.id === id);
    const to = Math.max(0, Math.min(pages.length - 1, index));
    if (from === -1 || from === to) {
      return;
    }
    const next = [...pages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  },

  current(): CapturedPage[] {
    return pages;
  },

  /**
   * Whether anything was ever in this session — see `everHeldPages`.
   *
   * Read by the review screen to tell "you removed them all" from "there was
   * never anything here", which are the same empty array.
   */
  hasHeldPages(): boolean {
    return everHeldPages;
  },

  /**
   * Remembers where every ordered page landed, for the save that follows.
   *
   * These are owner-prefixed object keys, not signed upload URLs. They remain
   * valid while the musician names the piece, and remain in the same order as
   * `current()`; sending only the first one was how a multi-page scan silently
   * became a one-page score.
   */
  setUploadedImageKeys(keys: string[]): void {
    uploadedImageKeys = [...keys];
    notify();
  },

  uploadedImageKeys(): string[] {
    return [...uploadedImageKeys];
  },

  /** Existing library entry that receives this scan, when there is one. */
  attachmentPieceId(): string | null {
    return attachmentPieceId;
  },
};
