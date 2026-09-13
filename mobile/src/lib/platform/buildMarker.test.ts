import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildMarker, hashFrom, markerFrom } from './buildMarker';

/**
 * Saying which build is running, which nobody could answer for a whole day.
 *
 * The microphone fix shipped and the phone still failed, and the three
 * candidate explanations — stale cache, a home-screen app resumed rather than
 * relaunched, or a test taken before the deploy — are indistinguishable
 * without this. Tested here rather than asserted in the screen because there
 * is no React Native testing library (`DECISIONS.md`, 2026-08-24), and because
 * none of it can be checked by looking.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading the build out of the bundle name', () => {
  it('takes the hash off the app bundle', () => {
    expect(
      hashFrom('/_expo/static/js/web/index-18281825d242899541a9997c344099f6.js'),
    ).toBe('18281825');
  });

  /*
   * **The bug this function exists to not repeat.** `public/index.html`'s crash
   * watchdog selects `script[src*="_expo"]`, and the export emits three files
   * under that path — the metro runtime and the common chunk sort before
   * `index-`, so the watchdog has been reporting the runtime's hash as the
   * bundle. A marker that names the wrong build is worse than no marker: it
   * reads as fact.
   */
  it('refuses the other bundles the export emits', () => {
    expect(
      hashFrom('/_expo/static/js/web/__expo-metro-runtime-1f8f5d3ca6b7f58204d51e14506d73fb.js'),
    ).toBe('');
    expect(
      hashFrom('/_expo/static/js/web/__common-d8175df49ca0da32d05658f3c9f3d0fb.js'),
    ).toBe('');
  });

  it('says nothing when there is nothing to read', () => {
    expect(hashFrom(null)).toBe('');
    expect(hashFrom('')).toBe('');
    expect(hashFrom('/_expo/static/js/web/index.js')).toBe('');
  });
});

describe('the line itself', () => {
  it('names the build, the origin and whether this is the installed app', () => {
    const line = markerFrom(
      '/_expo/static/js/web/index-18281825d242899541a9997c344099f6.js',
      'idk-41z.pages.dev',
      true,
    );

    expect(line).toBe('18281825 · idk-41z.pages.dev · home screen');
  });

  /*
   * The host is the part that mattered most on 2026-09-13: the owner reported
   * the microphone working on one link and failing on another, and the two
   * were a branch preview and production — different origins, different
   * caches, and at that moment different code.
   */
  it('keeps the host, which is what distinguishes a preview from production', () => {
    expect(
      markerFrom(
        '/_expo/static/js/web/index-abcdef1234567890.js',
        'claude-mobile-frontend-rebui.idk-41z.pages.dev',
        false,
      ),
    ).toBe('abcdef12 · claude-mobile-frontend-rebui.idk-41z.pages.dev');
  });

  it('leaves out what it cannot establish rather than guessing at it', () => {
    // A marker is only worth showing if every part of it is a fact.
    expect(markerFrom(null, 'idk-41z.pages.dev', false)).toBe('idk-41z.pages.dev');
    expect(markerFrom(null, '', false)).toBe('');
  });
});

describe('where there is no page', () => {
  it('says nothing rather than throwing inside a render', () => {
    vi.stubGlobal('document', undefined);
    expect(buildMarker(false)).toBe('');
  });
});
