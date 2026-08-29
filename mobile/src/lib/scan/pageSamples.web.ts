import type { PageSamples } from './legibility';

/**
 * The most pixels to measure, on each axis.
 *
 * A bound on the work, not on the detail — see `pageSamples` for why the
 * difference is the whole point.
 */
const MAX_SAMPLE_WIDTH = 1400;
const MAX_SAMPLE_HEIGHT = 2000;

/**
 * Greyscale samples from a captured page, for the legibility check.
 *
 * **A crop at native resolution, never a downscaled copy of the whole page.**
 * This is the one decision in the file and getting it wrong makes the check
 * measure its own resampling instead of the photograph: a 4032 px page shrunk
 * to 1400 takes its staff lines from 25 px apart to 8.7, and the lines
 * themselves — one or two pixels wide — merge into grey. The measurement would
 * then report a page as unreadable *because this function made it so*, and the
 * app would talk musicians out of photographs that were perfectly good.
 *
 * So the samples are cut from the middle of the photograph at 1:1, and `scale`
 * is 1. The centre is where music is: a strip two thousand rows tall through
 * the middle of a page crosses several systems whichever way up it is held.
 *
 * Returns null rather than throwing. Every failure here — a blob that will not
 * decode, a canvas the browser will not give back — means "nothing measured",
 * which `legibilityOf` already treats as silence.
 */
export async function pageSamples(uri: string): Promise<PageSamples | null> {
  try {
    const image = await decode(uri);
    const width = Math.min(image.width, MAX_SAMPLE_WIDTH);
    const height = Math.min(image.height, MAX_SAMPLE_HEIGHT);
    if (width < 8 || height < 24) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return null;
    }

    // The centre of the photograph, at 1:1.
    const left = Math.floor((image.width - width) / 2);
    const top = Math.floor((image.height - height) / 2);
    context.drawImage(image, left, top, width, height, 0, 0, width, height);
    close(image);

    const { data } = context.getImageData(0, 0, width, height);
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
      // Rec. 601 luma. Staff lines are neutral, so any sane weighting works;
      // this one is the conventional choice and needs no explaining later.
      gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }

    return { gray, width, height, scale: 1 };
  } catch {
    return null;
  }
}

type Decoded = ImageBitmap | HTMLImageElement;

async function decode(uri: string): Promise<Decoded> {
  // `createImageBitmap` decodes off the main thread and is what every current
  // browser has; the `<img>` path is the fallback, and is also what runs under
  // a DOM stub in tests.
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    const response = await fetch(uri);
    return createImageBitmap(await response.blob());
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('the page could not be decoded'));
    element.src = uri;
  });
}

function close(image: Decoded): void {
  if ('close' in image && typeof image.close === 'function') {
    image.close();
  }
}
