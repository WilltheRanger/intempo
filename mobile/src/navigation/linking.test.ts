import { describe, expect, it } from 'vitest';

import { pathsByScreen } from './linking';
// `?raw` so the route list is read from the file that declares it, the way
// `pickerTypes.test.ts` reads a patch — there is no runtime type to reflect on.
import typesSource from './types.ts?raw';

/** Every key of `RootStackParamList` and `TabParamList`, from the source. */
function declaredRoutes(): string[] {
  const names: string[] = [];
  for (const block of ['RootStackParamList', 'TabParamList']) {
    const start = typesSource.indexOf(`export type ${block} = {`);
    expect(start, `${block} is no longer declared`).toBeGreaterThan(-1);
    const body = typesSource.slice(start, typesSource.indexOf('\n};', start));
    for (const line of body.split('\n')) {
      // A route key sits at one indent level: `  Warmup: undefined;`
      const match = /^ {2}([A-Z][A-Za-z]*)\??:/.exec(line);
      if (match) names.push(match[1]);
    }
  }
  return [...new Set(names)];
}

describe('deep linking', () => {
  it('gives every screen a path', () => {
    // **A screen with no path is one the browser Back button leaves the app
    // from.** Measured on the shipping web build before this existed: Today,
    // Profile and Download-my-data were all `/`, and Back landed on
    // `about:blank` instead of the previous screen.
    //
    // Checked against the route list rather than a copy of it, so a screen
    // added next month fails here instead of shipping unlinkable.
    const paths = pathsByScreen();
    const missing = declaredRoutes().filter(
      (route) => route !== 'Tabs' && !(route in paths),
    );

    expect(missing, `these screens have no URL: ${missing.join(', ')}`).toEqual([]);
  });

  it('gives Today the bare path, so a cold start does not redirect', () => {
    expect(pathsByScreen().Today).toBe('');
  });

  it('never gives two screens the same path', () => {
    const paths = Object.entries(pathsByScreen());
    const seen = new Map<string, string>();
    for (const [screen, path] of paths) {
      const already = seen.get(path);
      expect(already, `${screen} and ${already} both claim "${path}"`).toBeUndefined();
      seen.set(path, screen);
    }
  });

  it('names the parameters the screen actually takes', () => {
    // A path that says `:pieceId` while the screen reads `params.id` produces a
    // screen that opens with nothing to show, and only from a link — which is
    // the one route nobody tests by hand.
    const paths = pathsByScreen();
    expect(paths.PieceDetail).toContain(':pieceId');
    expect(paths.MeasureEdit).toContain(':pieceId');
    expect(paths.MeasureEdit).toContain(':measureNumber');
    expect(paths.Verdict).toContain(':analysisId');
    expect(paths.AddPiece).toContain(':option');
  });
});
