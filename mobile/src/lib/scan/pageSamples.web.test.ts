import { afterEach, describe, expect, it, vi } from 'vitest';

import { pageSamples } from './pageSamples.web';

/**
 * The one link in the legibility chain that nothing measured.
 *
 * `legibility.contract.test.ts` runs the app's real `staffSpacing` over
 * greyscale samples stored in `fixtures/legibility/`, and those samples are
 * produced by `tools/legibility_fixture.py`, whose `app_samples` **reproduces
 * this file** — centre crop at 1:1, bounded to 1400x2000, Rec. 601 luma
 * truncated to a byte. The backend half of that contract recomputes them from
 * the JPEGs and checks they still match.
 *
 * So the Python is held to the fixture and the fixture is held to the app's
 * check. **Nothing held this function to the Python.** If the crop moved or the
 * luma changed here, every sample in the contract would go on describing what
 * the app used to see, and the direction rule it exists to protect would be
 * asserted about the wrong pixels.
 *
 * Two more reasons this is worth a stub rather than a browser. It is only
 * reachable from `ScannerScreen`, after a camera capture — there is no camera
 * in this container and none in CI, so the walk cannot get here. And **every
 * failure inside it returns null**, which `legibilityOf` treats as silence:
 * a broken `pageSamples` does not break anything visible, it just stops the
 * check running.
 */

/** What the crop is bounded to. Restated from the module, and pinned below. */
const MAX_SAMPLE_WIDTH = 1400;
const MAX_SAMPLE_HEIGHT = 2000;

interface DrawCall {
  left: number;
  top: number;
  width: number;
  height: number;
  destLeft: number;
  destTop: number;
  destWidth: number;
  destHeight: number;
}

/**
 * A canvas that records what it was asked to draw and answers with pixels.
 *
 * `pixels` is RGBA, row-major, sized to the *destination* rectangle — the same
 * thing `getImageData` returns after a real `drawImage`. The stub does no
 * sampling of its own, deliberately: this is checking what the function asks
 * for and what it does with the answer, and a stub that resampled would be a
 * second implementation to get wrong.
 */
function stubCanvas(pixels: (width: number, height: number) => Uint8ClampedArray) {
  const draws: DrawCall[] = [];
  let context: unknown = null;
  const canvas = {
    width: 0,
    height: 0,
    getContext(kind: string, options?: { willReadFrequently?: boolean }) {
      context = {
        kind,
        options,
        drawImage(
          _image: unknown,
          left: number,
          top: number,
          width: number,
          height: number,
          destLeft: number,
          destTop: number,
          destWidth: number,
          destHeight: number,
        ) {
          draws.push({ left, top, width, height, destLeft, destTop, destWidth, destHeight });
        },
        getImageData(_x: number, _y: number, width: number, height: number) {
          return { data: pixels(width, height) };
        },
      };
      return context;
    },
  };
  return { canvas, draws, get context() { return context; } };
}

/** Install a document, an image decoder and a source of pixels. */
function withBrowser({
  image,
  pixels,
  noContext = false,
}: {
  image: { width: number; height: number };
  pixels?: (width: number, height: number) => Uint8ClampedArray;
  noContext?: boolean;
}) {
  const stub = stubCanvas(
    pixels ?? ((width, height) => new Uint8ClampedArray(width * height * 4).fill(255)),
  );
  if (noContext) {
    stub.canvas.getContext = () => null as never;
  }
  const closed = { count: 0 };

  vi.stubGlobal('document', { createElement: () => stub.canvas });
  vi.stubGlobal('fetch', async () => ({ blob: async () => ({}) }));
  vi.stubGlobal('createImageBitmap', async () => ({
    ...image,
    close() {
      closed.count += 1;
    },
  }));
  return { ...stub, closed };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the crop it takes', () => {
  it('is the centre of the photograph, at 1:1', async () => {
    // 4284x5712 — the page `MIN_LONG_EDGE`'s docstring is measured against.
    const browser = withBrowser({ image: { width: 4284, height: 5712 } });

    const samples = await pageSamples('blob:page');

    expect(samples).not.toBeNull();
    expect(browser.draws).toHaveLength(1);
    const [draw] = browser.draws;
    // Bounded on both axes…
    expect(draw.width).toBe(MAX_SAMPLE_WIDTH);
    expect(draw.height).toBe(MAX_SAMPLE_HEIGHT);
    // …centred…
    expect(draw.left).toBe(Math.floor((4284 - MAX_SAMPLE_WIDTH) / 2));
    expect(draw.top).toBe(Math.floor((5712 - MAX_SAMPLE_HEIGHT) / 2));
    // …and drawn at its own size. **This is the load-bearing one.** Shrinking
    // the page shrinks the staff spacing being measured, so a resampling crop
    // would have the check report a page as unreadable because this function
    // made it so.
    expect(draw.destWidth).toBe(draw.width);
    expect(draw.destHeight).toBe(draw.height);
    expect(samples!.scale).toBe(1);
  });

  it('takes the whole image when it is smaller than the bound', async () => {
    const browser = withBrowser({ image: { width: 900, height: 1273 } });

    const samples = await pageSamples('blob:page');

    expect(browser.draws[0]).toMatchObject({ left: 0, top: 0, width: 900, height: 1273 });
    expect(samples).toMatchObject({ width: 900, height: 1273, scale: 1 });
  });

  it('releases the decoded bitmap', async () => {
    // A page is several megabytes decoded, and the scanner takes one per
    // shutter press.
    const browser = withBrowser({ image: { width: 900, height: 1273 } });

    await pageSamples('blob:page');

    expect(browser.closed.count).toBe(1);
  });
});

describe('the greyscale it returns', () => {
  it('is Rec. 601 luma, truncated, exactly as the fixture generator computes it', async () => {
    /*
     * **The parity claim.** `tools/legibility_fixture.py` writes
     * `(red * 299 + green * 587 + blue * 114) // 1000` into a byte, and every
     * sample in `fixtures/legibility/` was produced that way. Python's `//`
     * floors; assigning into a `Uint8Array` truncates. They agree for
     * non-negative values, which these are — and the cases below are chosen so
     * that a rounding difference would show: each one sits just under a whole
     * number.
     */
    const cases: [number, number, number][] = [
      [255, 255, 255],
      [0, 0, 0],
      [255, 0, 0], // 76.245  — a whole number either way only if truncated
      [0, 255, 0], // 149.685
      [0, 0, 255], //  29.07
      [128, 200, 64], // 162.968
      [17, 33, 49], //  30.04
      [7, 11, 13], //   9.99  — the case that separates flooring from rounding
    ];
    // 8 wide because `pageSamples` refuses anything narrower — a sane refusal
    // and the reason this row is exactly the width it is.
    const width = 8;
    const height = 24;
    const flat = new Uint8ClampedArray(width * height * 4);
    cases.forEach(([r, g, b], i) => {
      flat[i * 4] = r;
      flat[i * 4 + 1] = g;
      flat[i * 4 + 2] = b;
      flat[i * 4 + 3] = 255;
    });
    withBrowser({ image: { width, height }, pixels: () => flat });

    const samples = await pageSamples('blob:page');

    expect(samples).not.toBeNull();
    const python = (r: number, g: number, b: number) =>
      Math.floor((r * 299 + g * 587 + b * 114) / 1000);
    cases.forEach(([r, g, b], i) => {
      expect(samples!.gray[i], `pixel ${i} = rgb(${r}, ${g}, ${b})`).toBe(python(r, g, b));
    });
  });

  it('has one byte per pixel of the crop', async () => {
    const samples = await (async () => {
      withBrowser({ image: { width: 40, height: 30 } });
      return pageSamples('blob:page');
    })();

    expect(samples!.gray).toHaveLength(40 * 30);
  });
});

describe('what it refuses', () => {
  it('says nothing about an image too small to hold a staff', async () => {
    withBrowser({ image: { width: 4, height: 4 } });

    expect(await pageSamples('blob:tiny')).toBeNull();
  });

  it('says nothing when the browser will not give a 2d context', async () => {
    withBrowser({ image: { width: 900, height: 1273 }, noContext: true });

    expect(await pageSamples('blob:page')).toBeNull();
  });

  it('says nothing when the image will not decode', async () => {
    vi.stubGlobal('document', { createElement: () => ({}) });
    vi.stubGlobal('fetch', async () => {
      throw new Error('network');
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1 }));

    expect(await pageSamples('blob:broken')).toBeNull();
  });
});
