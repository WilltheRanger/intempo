import { useSyncExternalStore } from 'react';

import type { ThumbnailSource } from './types';

export interface CapturedPage {
  id: string;
  source: ThumbnailSource;
}

/** What became of an image the session was handed. */
export type CaptureOutcome = 'added' | 'replaced';

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
/** Set by the transcribe step, consumed by the save. See `setUploadedImageUrl`. */
let uploadedImageUrl: string | null = null;
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

export const captureSession = {
  /** Clears the session, retake included. Called when the scanner opens fresh. */
  reset(): void {
    nextId = 1;
    uploadedImageUrl = null;
    retakingId = null;
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
  capture(source: ThumbnailSource): CaptureOutcome {
    const target = retakingId;
    retakingId = null;

    if (target !== null && pages.some((page) => page.id === target)) {
      commit(pages.map((page) => (page.id === target ? { ...page, source } : page)));
      return 'replaced';
    }

    // The page being retaken is no longer in the session — deleted from
    // another screen, or a session reset underneath. Append rather than drop:
    // a photograph someone has just taken is never thrown away, and an extra
    // page at the end is visible and removable in a way a discarded one is not.
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
  importAll(sources: ThumbnailSource[]): void {
    nextId = 1;
    uploadedImageUrl = null;
    retakingId = null;
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
   * Remembers where the uploaded page landed, for the save that follows.
   *
   * The value is a **signed upload URL that expires five minutes after
   * issue** — the only form `POST /v1/scores` accepts. It lives here rather
   * than in route params because the review screen can be left and returned
   * to, and because `reset()` must be able to clear it: a stale URL from a
   * previous scan is worse than none, since the save would fail against an
   * expired signature with nothing on screen explaining why.
   */
  setUploadedImageUrl(url: string | null): void {
    uploadedImageUrl = url;
    notify();
  },

  uploadedImageUrl(): string | null {
    return uploadedImageUrl;
  },
};
