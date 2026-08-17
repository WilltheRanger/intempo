import { useSyncExternalStore } from 'react';

import type { ThumbnailSource } from './types';

export interface CapturedPage {
  id: string;
  source: ThumbnailSource;
}

/**
 * The pages captured in the current scan, shared between the scanner and the
 * review screen.
 *
 * Deliberately not route params: reordering and deleting have to survive the
 * round trip when someone goes back to add another page, and params would
 * reset that. Module-level rather than a provider because a capture session is
 * genuinely global — there is only ever one in flight.
 *
 * This is where real capture output lands later. Nothing above it changes.
 */
let pages: CapturedPage[] = [];
let nextId = 1;
/** Set by the transcribe step, consumed by the save. See `setUploadedImageUrl`. */
let uploadedImageUrl: string | null = null;

const listeners = new Set<() => void>();

function commit(next: CapturedPage[]): void {
  pages = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
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
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const captureSession = {
  /** Clears the session. Called when the scanner opens fresh. */
  reset(): void {
    nextId = 1;
    uploadedImageUrl = null;
    commit([]);
  },

  add(source: ThumbnailSource): void {
    commit([...pages, { id: `page-${nextId++}`, source }]);
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

  /** Replaces one page's image, standing in for re-shooting it. */
  replace(id: string, source: ThumbnailSource): void {
    commit(pages.map((page) => (page.id === id ? { ...page, source } : page)));
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
    listeners.forEach((listener) => listener());
  },

  uploadedImageUrl(): string | null {
    return uploadedImageUrl;
  },
};
