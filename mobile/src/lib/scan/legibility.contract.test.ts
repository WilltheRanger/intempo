import { describe, expect, it } from 'vitest';

import { legibilityOf, staffSpacing, type PageSamples } from './legibility';

// The shared contract, imported rather than read off disk — the same reason
// `schedule.parity.test.ts` gives: a bundler-resolved import fails at build
// time if the fixture moves, where a path string fails at run time in
// whichever suite happened to run first. (This project has no `@types/node`,
// so there is no `readFileSync` to reach for anyway.)
import parity from '../../../../fixtures/legibility/parity.json';
import simplePrinted from '../../../../fixtures/legibility/01_simple_printed.samples.json';
import complexPrinted from '../../../../fixtures/legibility/03_complex_printed.samples.json';
import handwrittenClean from '../../../../fixtures/legibility/04_handwritten_clean.samples.json';
import handwrittenMessy from '../../../../fixtures/legibility/05_handwritten_messy.samples.json';
import pageShaped from '../../../../fixtures/legibility/page-01.samples.json';

/**
 * The app's legibility check, on pages the server has also measured.
 *
 * **`legibility.test.ts` cannot catch what this catches, and that is not a
 * criticism of it.** Its pages are synthesised so the answer is known, which
 * is the right way to ask whether a measurement recovers the number it was
 * given. But a ruled page is five rows of ink on clean paper: its ink profile
 * decorrelates immediately, so the shoulder of the zero-lag peak — the thing a
 * real photograph has and a drawing does not — never appears, and a bug that
 * lives entirely in that shoulder is invisible to every case in the file.
 *
 * That bug was live. Measured 2026-09-04, before the fix in `strongestPeriod`:
 *
 *     page                      server    app     app verdict
 *     01_simple_printed          11.0      10     ok
 *     03_complex_printed         11.0       3     tooSmall   <- server reads it
 *     04_handwritten_clean        9.25      3     tooSmall   <- server reads it
 *     05_handwritten_messy        6.0       3     tooSmall
 *     page-01                     7.0       5     tooSmall
 *
 * Two pages the pipeline reads correctly, and the app was offering the
 * musician a retake with "Too far away to read the notes." Nothing was red:
 * `CLIENT_FLOOR < SERVER_FLOOR` still held, because an ordering of two
 * constants says nothing about what two different algorithms do to a
 * photograph.
 *
 * The samples are what `pageSamples.web.ts` would hand this check for those
 * pages, and `backend/app/tests/test_legibility_contract.py` recomputes them
 * from the JPEGs and re-runs `staff_space_px`, so neither the pages nor the
 * server's answers can drift away underneath.
 */

const SAMPLES: Record<string, { gzip_b64: string }> = {
  '01_simple_printed': simplePrinted,
  '03_complex_printed': complexPrinted,
  '04_handwritten_clean': handwrittenClean,
  '05_handwritten_messy': handwrittenMessy,
  'page-01': pageShaped,
};

/**
 * How far apart the two measurements are allowed to be, and in which
 * direction.
 *
 * **Not equality**, because they are deliberately not the same algorithm: the
 * server tiles a page into systems and takes a low percentile across them, the
 * app measures its densest band alone. On the pages here they land at 11/11,
 * 11/11, 15/9.25, 5/6 and 7/7 — agreement to well within a factor of two, and
 * the one large gap is the app reading *high*.
 *
 * High is the harmless direction and it is harmless for a reason rather than
 * by luck: autocorrelation peaks at every multiple of a period and never at a
 * divisor, so over-reading is the failure this measurement can have, and an
 * over-read spacing only ever makes the app quieter. Under-reading is what
 * produces a warning, so that is the side with a bound on it.
 */
const NEVER_BELOW = 0.5;

async function samplesFor(name: string, width: number, height: number): Promise<PageSamples> {
  const packed = SAMPLES[name];
  expect(packed, `${name} has no samples file imported into this test`).toBeDefined();
  const raw = atob(packed.gzip_b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const gray = new Uint8Array(await new Response(stream).arrayBuffer());
  expect(gray.length, `${name} samples are not ${width}x${height}`).toBe(width * height);
  // `scale: 1` is not a simplification: `pageSamples.web.ts` crops at 1:1 and
  // returns 1, and measuring a downscaled copy is the thing it refuses to do.
  return { gray, width, height, scale: 1 };
}

describe('the app and the server on the same page', () => {
  it('imports a samples file for every page the contract lists', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(parity.pages.map((page) => page.name).sort());
  });

  it.each(parity.pages)('$name — never refuses a page the server reads', async (page) => {
    const verdict = legibilityOf(await samplesFor(page.name, page.width, page.height));

    if (!page.server_refuses) {
      expect(
        verdict.verdict,
        `the server reads this page at ${page.server_staff_space_px}px; the app must not warn about it`,
      ).not.toBe('tooSmall');
    }
  });

  it.each(parity.pages)('$name — measures something at all', async (page) => {
    // **The guard on the test above.** `legibilityOf` answers `unknown` when it
    // can find no period, and `unknown` is silence — which satisfies "never
    // refuses" on every page at once. A check that has quietly stopped
    // measuring anything would pass the rule and help nobody, and that is the
    // shape of vacuous pass this repository has been caught by before.
    expect(staffSpacing(await samplesFor(page.name, page.width, page.height))).not.toBeNull();
  });

  it.each(parity.pages)('$name — is not far under the server', async (page) => {
    const spacing = staffSpacing(await samplesFor(page.name, page.width, page.height));

    expect(spacing).not.toBeNull();
    expect(
      spacing!,
      `the server measures ${page.server_staff_space_px}px here`,
    ).toBeGreaterThanOrEqual(page.server_staff_space_px * NEVER_BELOW);
  });
});
