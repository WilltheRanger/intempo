import { beforeEach, describe, expect, it } from 'vitest';

import { cover, noOverlays, uncover, type Inertable, type OverlayDepth } from './rootInert';

/**
 * Whether the app behind an overlay can be reached.
 *
 * This governs HTML `inert` on `#root`, which takes every button and field in
 * the app out of the keyboard order, out of pointer input and out of the
 * accessibility tree. The two ways to get the count wrong are both bad and
 * neither is visible in a screenshot: one decrement too many and the app is
 * live underneath an open dialog, one too few and it is permanently dead with
 * nothing on screen to explain why.
 *
 * It was module-level state inside a hook until now, so none of this could be
 * asked.
 */

let root: Inertable;
let overlays: OverlayDepth;

beforeEach(() => {
  root = { inert: false };
  overlays = noOverlays();
});

describe('one overlay', () => {
  it('shuts the app off while it is up, and hands it back after', () => {
    cover(overlays, root);
    expect(root.inert).toBe(true);

    uncover(overlays, root);
    expect(root.inert).toBe(false);
  });
});

describe('overlays that stack', () => {
  it('does not hand the app back when only the top one closes', () => {
    // A confirmation opened over a sheet. This is the case the counting exists
    // for: the sheet is still up, and the app behind it is still covered.
    cover(overlays, root); // the sheet
    cover(overlays, root); // the confirmation over it

    uncover(overlays, root); // the confirmation goes

    expect(root.inert).toBe(true);
  });

  it('hands it back when the last one closes', () => {
    cover(overlays, root);
    cover(overlays, root);
    uncover(overlays, root);
    uncover(overlays, root);

    expect(root.inert).toBe(false);
  });

  it('does not care which one closes first', () => {
    // Unmount order is React's business, not this rule's. Three up, three
    // down, in whatever order — the app comes back exactly once.
    cover(overlays, root);
    cover(overlays, root);
    cover(overlays, root);
    uncover(overlays, root);
    expect(root.inert).toBe(true);
    uncover(overlays, root);
    expect(root.inert).toBe(true);
    uncover(overlays, root);
    expect(root.inert).toBe(false);
  });
});

describe('a root that was already inert', () => {
  it('is left inert, because this did not make it so', () => {
    // Restored rather than assumed false: something else may own the flag, and
    // a cleanup that writes `false` unconditionally quietly takes it over.
    root.inert = true;

    cover(overlays, root);
    uncover(overlays, root);

    expect(root.inert).toBe(true);
  });

  it('reads that state once, not on every overlay', () => {
    // **The bug this ordering prevents.** Reading `root.inert` on every open
    // would capture `true` — the value `cover` itself just wrote — and the last
    // close would then leave the app inert for good, on a screen with no
    // dialog on it.
    cover(overlays, root); // saves false, sets true
    cover(overlays, root); // must not re-read and save true
    uncover(overlays, root);
    uncover(overlays, root);

    expect(root.inert).toBe(false);
  });
});

describe('closes that do not match an open', () => {
  it('cannot drive the count below zero', () => {
    // The permanent version of the failure: a negative count means the next
    // open never reaches zero again on the way out, and the app stays dead for
    // the rest of the session.
    uncover(overlays, root);
    uncover(overlays, root);
    expect(overlays.depth).toBe(0);

    cover(overlays, root);
    expect(root.inert).toBe(true);
    uncover(overlays, root);
    expect(root.inert).toBe(false);
  });
});

describe('React mounting an effect twice', () => {
  it('survives a mount, cleanup, mount', () => {
    // What StrictMode does in development. The second `cover` must save the
    // state the cleanup restored, not the one the first `cover` wrote.
    cover(overlays, root);
    uncover(overlays, root);
    cover(overlays, root);

    expect(root.inert).toBe(true);
    uncover(overlays, root);
    expect(root.inert).toBe(false);
  });
});
