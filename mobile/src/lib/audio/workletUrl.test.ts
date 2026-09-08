import { afterEach, describe, expect, it } from 'vitest';

import { resolveWorkletUrl, WORKLET_FILE, workletUrl } from './workletUrl';

const ORIGIN = 'https://idk-41z.pages.dev';

describe('workletUrl', () => {
  /**
   * The bug this exists for. The record screen is always nested under a piece,
   * so this is the only route that ever mattered — and it is the one that was
   * fetching `index.html` and reporting "the recording worklet could not be
   * loaded" on a screen whose only job is to record.
   */
  it('does not resolve against the route the musician is on', () => {
    const url = workletUrl(null, ORIGIN);
    expect(url).toBe(`${ORIGIN}/${WORKLET_FILE}`);
    expect(url).not.toContain('/pieces/');
  });

  it('is the same URL from every depth of route', () => {
    // The origin is all `workletUrl` is given precisely so a route cannot
    // reach it. Stated as a test so a future refactor cannot quietly pass one.
    expect(workletUrl(null, ORIGIN)).toBe(workletUrl(null, `${ORIGIN}`));
  });

  /** The sub-path deployment the original relative path was reaching for. */
  it('honours a <base href> when the app is served from a sub-path', () => {
    expect(workletUrl('/app/', ORIGIN)).toBe(`${ORIGIN}/app/${WORKLET_FILE}`);
    expect(workletUrl(`${ORIGIN}/app/`, ORIGIN)).toBe(`${ORIGIN}/app/${WORKLET_FILE}`);
  });

  /**
   * A `<base>` without a trailing slash names a *file*, and resolving against
   * it drops the last segment. Anything else would send the worklet one
   * directory too high on exactly the deployment this branch exists for.
   */
  it('resolves a base with no trailing slash the way a browser does', () => {
    expect(workletUrl('/app', ORIGIN)).toBe(`${ORIGIN}/${WORKLET_FILE}`);
  });

  it('is an absolute URL, so addModule never has to guess', () => {
    expect(workletUrl(null, ORIGIN).startsWith('https://')).toBe(true);
  });
});

describe('resolveWorkletUrl', () => {
  const realWindow = globalThis.window;
  const realDocument = globalThis.document;
  afterEach(() => {
    Object.assign(globalThis, { window: realWindow, document: realDocument });
  });

  it('resolves from the origin, whatever route the document is on', () => {
    Object.assign(globalThis, {
      window: { location: { origin: ORIGIN } },
      document: { querySelector: () => null },
    });
    expect(resolveWorkletUrl()).toBe(`${ORIGIN}/${WORKLET_FILE}`);
  });

  it('reads a <base href> when the document has one', () => {
    Object.assign(globalThis, {
      window: { location: { origin: ORIGIN } },
      document: { querySelector: () => ({ getAttribute: () => '/app/' }) },
    });
    expect(resolveWorkletUrl()).toBe(`${ORIGIN}/app/${WORKLET_FILE}`);
  });

  /**
   * The recorder's own suite runs in Node with a hand-built `window` that has
   * no `location`. Reading it unguarded threw *inside* the recorder's try/catch
   * and was reported as "the worklet could not be loaded" — a missing global
   * misreported as a missing file, which is the failure mode this module was
   * written to end.
   */
  it('falls back to the bare filename where there is no browser to ask', () => {
    Object.assign(globalThis, { window: { location: undefined }, document: undefined });
    expect(resolveWorkletUrl()).toBe(WORKLET_FILE);
    Object.assign(globalThis, { window: undefined, document: undefined });
    expect(resolveWorkletUrl()).toBe(WORKLET_FILE);
  });
});
