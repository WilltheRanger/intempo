import { describe, expect, it } from 'vitest';

import { pathsByScreen, screenConfig } from './linking';
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

describe('parameters that are not strings', () => {
  it('parses the measure number back into a number', () => {
    // **`5 === "5"` is false**, and that is the whole bug. A URL parameter
    // always arrives as text; `MeasureEditScreen` compares it to
    // `measure_number` with `===`, so without a `parse` the editor opens from a
    // link, matches no measure, and still titles itself "Bar 5". It looks like
    // it worked. Nothing but a cold open would notice.
    const config = screenConfig?.screens as Record<string, unknown>;
    const measureEdit = config.MeasureEdit as {
      path: string;
      parse?: Record<string, (value: string) => unknown>;
    };

    expect(measureEdit.parse?.measureNumber).toBeTypeOf('function');
    expect(measureEdit.parse!.measureNumber('5')).toBe(5);
    expect(measureEdit.parse!.measureNumber('5')).not.toBe('5');
  });

  it('parses every numeric parameter some screen declares', () => {
    // Read from `types.ts` rather than listed here, so a route added with a
    // numeric parameter fails this instead of shipping unparsed.
    const numeric: Array<[string, string]> = [];
    for (const line of typesSource.split('\n')) {
      const route = /^ {2}([A-Z][A-Za-z]*)\??: \{(.*)\};$/.exec(line);
      if (!route) continue;
      for (const param of route[2].matchAll(/([a-zA-Z]+)\??: number/g)) {
        numeric.push([route[1], param[1]]);
      }
    }
    expect(numeric.length, 'no numeric route parameters found to check').toBeGreaterThan(0);

    const config = screenConfig?.screens as Record<string, unknown>;
    for (const [route, param] of numeric) {
      const entry = config[route] as { parse?: Record<string, unknown> } | string;
      expect(
        typeof entry === 'object' && typeof entry.parse?.[param] === 'function',
        `${route}.${param} is a number but its path does not parse it`,
      ).toBe(true);
    }
  });
});
