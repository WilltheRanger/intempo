import { beforeEach, describe, expect, it } from 'vitest';

import { captureSession, subscribeToCaptureSession } from './captureSession';

/**
 * The scan between the shutter and the upload.
 *
 * Untested until now, which is how four defects came to live in it at once.
 * The ones that mattered were both about retake, and both start in the same
 * place: the screen decided what happened to a photograph, and decided wrong.
 *
 * These are not component tests — this project has no React Native testing
 * library — and that is the reason the rules live in the store rather than in
 * the screen, the same move `transcriptionProgress.ts` made for the progress
 * bar. What the screens still own is navigation, and only navigation.
 */

const PAGE = (n: number) => `file:///page-${n}.jpg`;

function scanOf(count: number): void {
  captureSession.importAll(
    Array.from({ length: count }, (_, index) => PAGE(index + 1)),
  );
}

function sources(): string[] {
  return captureSession.current().map((page) => page.source as string);
}

beforeEach(() => {
  captureSession.reset();
});

describe('capturing pages', () => {
  it('appends, in the order they were shot', () => {
    expect(captureSession.capture(PAGE(1))).toBe('added');
    captureSession.capture(PAGE(2));

    expect(sources()).toEqual([PAGE(1), PAGE(2)]);
  });

  it('gives every page an id of its own, across removals', () => {
    // Reused ids would make `beginRetake` name a different page than the one
    // tapped, which is the whole mechanism here.
    captureSession.capture(PAGE(1));
    captureSession.capture(PAGE(2));
    const [first] = captureSession.current();
    captureSession.remove(first.id);
    captureSession.capture(PAGE(3));

    const ids = captureSession.current().map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(first.id);
  });
});

describe('retaking a page', () => {
  it('puts the new photograph where the old one was, not at the end', () => {
    // The defect, in one line. Retake removed the page and the shutter
    // appended, so the new page 1 of a four-page scan landed at position 4 and
    // page 2 was promoted into first place. `TranscribeScreen` uploads
    // `pages[0]`, so the app transcribed page 2 of the piece and the page just
    // re-shot was never sent at all.
    scanOf(4);
    const [first] = captureSession.current();

    captureSession.beginRetake(first.id);
    expect(captureSession.capture('file:///reshot.jpg')).toBe('replaced');

    expect(sources()).toEqual([
      'file:///reshot.jpg',
      PAGE(2),
      PAGE(3),
      PAGE(4),
    ]);
  });

  it('keeps the page while the retake is only pending', () => {
    // Nothing may be lost between tapping Retake and a photograph arriving.
    scanOf(3);
    const [, second] = captureSession.current();

    captureSession.beginRetake(second.id);

    expect(sources()).toEqual([PAGE(1), PAGE(2), PAGE(3)]);
    expect(captureSession.retaking()).toBe(second.id);
  });

  it('leaves the scan untouched when the retake is abandoned', () => {
    // Closing the viewfinder, or a shutter that returns no image — both were
    // a silent, unconfirmed delete of the page, on a screen whose delete
    // button asks first and warns that the photo goes with it.
    scanOf(3);
    const [, second] = captureSession.current();

    captureSession.beginRetake(second.id);
    captureSession.cancelRetake();

    expect(sources()).toEqual([PAGE(1), PAGE(2), PAGE(3)]);
    expect(captureSession.retaking()).toBeNull();
  });

  it('is over after one photograph', () => {
    // Otherwise the next page shot would overwrite the one just retaken.
    scanOf(2);
    const [first] = captureSession.current();

    captureSession.beginRetake(first.id);
    captureSession.capture('file:///reshot.jpg');
    expect(captureSession.retaking()).toBeNull();

    expect(captureSession.capture(PAGE(3))).toBe('added');
    expect(sources()).toEqual(['file:///reshot.jpg', PAGE(2), PAGE(3)]);
  });

  it('keeps a photograph taken for a page that is no longer there', () => {
    // An extra page at the end is visible and removable. A photograph silently
    // dropped is neither, and the musician has already put the page on the
    // stand and taken the shot.
    scanOf(2);
    const [first] = captureSession.current();
    captureSession.beginRetake(first.id);
    captureSession.remove(first.id);

    expect(captureSession.capture('file:///orphan.jpg')).toBe('added');
    expect(sources()).toEqual([PAGE(2), 'file:///orphan.jpg']);
  });

  it('does not survive the session it belongs to', () => {
    // `reset` runs when the scanner opens fresh. A retake left pointing at a
    // page id from a scan that no longer exists would make the first
    // photograph of the next scan land as a replacement for nothing.
    scanOf(2);
    captureSession.beginRetake(captureSession.current()[0].id);

    captureSession.reset();
    expect(captureSession.retaking()).toBeNull();

    captureSession.importAll([PAGE(9)]);
    captureSession.beginRetake(captureSession.current()[0].id);
    captureSession.importAll([PAGE(8)]);
    expect(captureSession.retaking()).toBeNull();
  });
});

describe('importing pages', () => {
  it('replaces whatever was in the session', () => {
    scanOf(2);
    captureSession.importAll([PAGE(7), PAGE(8), PAGE(9)]);

    expect(sources()).toEqual([PAGE(7), PAGE(8), PAGE(9)]);
  });

  it('publishes the pages once, never an empty list first', () => {
    // It was a `reset()` followed by a loop of `add`s, so every subscriber saw
    // the session empty and then growing a page at a time — a review screen
    // that renders its own empty state on the way in.
    scanOf(1);
    const seen: number[] = [];
    const unsubscribe = subscribeToCaptureSession(() =>
      seen.push(captureSession.current().length),
    );

    captureSession.importAll([PAGE(1), PAGE(2), PAGE(3)]);
    unsubscribe();

    expect(seen).toEqual([3]);
  });

  it('clears the upload from the scan it replaces', () => {
    // A signed URL from the previous scan would let the save go through
    // against a page nobody chose.
    scanOf(1);
    captureSession.setUploadedImageUrl('https://example.test/signed');

    captureSession.importAll([PAGE(5)]);
    expect(captureSession.uploadedImageUrl()).toBeNull();
  });
});
