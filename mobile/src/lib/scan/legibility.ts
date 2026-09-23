/**
 * Whether the page just photographed has enough detail to be read.
 *
 * **Why the app measures this at all, when the server already does.** The
 * server's answer arrives after the upload, after the queue and after the
 * worker has fetched the page — minutes later, on a different screen, about a
 * photograph the musician is no longer holding the music for. By then the
 * advice ("photograph the page again from closer") costs a whole round trip to
 * act on. The same answer at the shutter costs one more press.
 *
 * **This is a subset, deliberately, and it is the second one in this project
 * for the same reason.** `notation/reading.ts` keeps a local beat-sum check
 * while the server owns the full validator; this keeps a local legibility check
 * while `page_image.too_small_to_read` owns the real one. The rule both follow:
 *
 *   > it may never refuse a page the server would accept.
 *
 * So `CLIENT_FLOOR` sits **below** the server's floor, not at it, and anything
 * this cannot measure is silence rather than a warning. Getting that backwards
 * would turn a helpful hint into the app talking a musician out of a
 * photograph that would have read perfectly well — which is worse than the
 * delay it exists to save. `legibility.test.ts` asserts the direction.
 *
 * Nothing here decides anything: the shutter is not blocked and the page is not
 * discarded. It says what it sees and offers a retake.
 */

/**
 * The server refuses a page below this many pixels between staff lines.
 *
 * `_MIN_STAFF_SPACE_PX` in `backend/app/services/page_image.py`. Restated here
 * only so `CLIENT_FLOOR` can be defined as strictly under it — nothing in this
 * file compares against it directly.
 */
export const SERVER_FLOOR = 8;

/**
 * Where *this* check starts speaking.
 *
 * Below the server's floor on purpose. This measurement is coarser than the
 * server's — one band rather than a percentile across all of them, no cap on a
 * band reporting a staff taller than itself — so it must be given room to be
 * wrong in the harmless direction. A page it stays quiet about and the server
 * then refuses is the behaviour that exists today; a page it warns about and
 * the server would have read is a regression.
 */
export const CLIENT_FLOOR = 6;

/** The narrowest lag that can be a staff rather than halftone or sensor noise. */
const MIN_PERIOD = 3;

/** Wider than any staff on a page photographed to fill the frame. */
const MAX_PERIOD = 60;

/**
 * How tall a normalised autocorrelation peak has to be to count as a period.
 *
 * The measured staff peak on a real capture was 0.662 and its own multiples
 * were around 0.28, so anything between roughly 0.35 and 0.65 separates them.
 * 0.5 is the middle of that, and the middle is the point: a bar fitted to
 * either edge is a bar fitted to one photograph.
 *
 * Erring high is the safe direction. Too high and this returns null, which is
 * silence — the behaviour that existed before this check. Too low and it finds
 * a period in something that is not a staff, reports a small number, and warns
 * about a photograph that was fine.
 */
const STRONG_PEAK = 0.5;

export type Legibility =
  /** Measured, and there is enough detail. */
  | { verdict: 'ok'; spacing: number }
  /** Measured, and there is not. */
  | { verdict: 'tooSmall'; spacing: number }
  /** Nothing could be measured. Says nothing — see the module note. */
  | { verdict: 'unknown'; spacing: null };

export interface PageSamples {
  /** Greyscale, one byte per pixel, row-major. 0 is black. */
  gray: Uint8Array | number[];
  width: number;
  height: number;
  /**
   * How much the samples were shrunk from the photograph, ≥ 1.
   *
   * **Load-bearing.** Measuring a downscaled copy and reporting the answer
   * as-is understates the spacing by exactly this factor, which would have the
   * app warning about every good page it looked at. The spacing returned is
   * always in *source* pixels.
   */
  scale: number;
}

/**
 * How many source pixels apart this page's staff lines are, or null.
 *
 * Null means no band of this image had a repeating horizontal period in it —
 * not that the page is empty. That distinction is the same one
 * `staff_space_px` draws, and for the same reason: a page photographed from
 * too far away still has systems on it, it just no longer has five
 * distinguishable lines.
 */
export function staffSpacing({ gray, width, height, scale }: PageSamples): number | null {
  if (width < 8 || height < MIN_PERIOD * 4 || scale <= 0) {
    return null;
  }

  const ink = inkPerRow(gray, width, height);
  const band = densestBand(ink);
  if (!band) {
    return null;
  }

  const period = strongestPeriod(ink, band.from, band.to);
  return period === null ? null : period * scale;
}

/**
 * Ink in each row, measured against the paper immediately around it.
 *
 * Against the row's own bright end rather than a threshold over the whole
 * image: a page held in the hand is lit unevenly, and a global threshold reads
 * the shadowed half as solid ink. Same reasoning as the server's `_ink_profile`
 * and a far cruder execution of it.
 */
function inkPerRow(
  gray: Uint8Array | number[],
  width: number,
  height: number,
): Float64Array {
  const ink = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    const start = y * width;
    let brightest = 0;
    for (let x = 0; x < width; x += 1) {
      const value = gray[start + x];
      if (value > brightest) brightest = value;
    }
    // A quarter below the row's own paper. Staff lines on a photographed page
    // are grey, not black, so an absolute threshold misses them entirely.
    const threshold = brightest * 0.75;
    let dark = 0;
    for (let x = 0; x < width; x += 1) {
      if (gray[start + x] < threshold) dark += 1;
    }
    ink[y] = dark / width;
  }
  return ink;
}

/**
 * The rows holding the most ink — one system, roughly.
 *
 * The server tiles the whole page into systems and measures each. This takes
 * the densest stretch and measures that alone, which is the coarse half of the
 * same idea: if the best-inked band on the page has no staff period in it, no
 * other band will either.
 */
function densestBand(ink: Float64Array): { from: number; to: number } | null {
  const height = ink.length;
  // **Wide enough to hold several of the widest period this looks for.**
  //
  // It was `height / 12` — about one system on a full page, which sounds right
  // and is not: autocorrelation needs three periods to see one, so a 50-row
  // window can only ever find a staff up to about 16 rows. A page photographed
  // close enough that its staff lines are 20 px apart — a *good* page, the kind
  // this must never warn about — had no period findable in it at all, and
  // fell through to `unknown`. Silence is the harmless answer, which is exactly
  // why it would have gone unnoticed.
  const window = Math.max(MAX_PERIOD * 4, Math.floor(height / 8));
  if (window >= height) {
    return { from: 0, to: height };
  }

  let running = 0;
  for (let y = 0; y < window; y += 1) running += ink[y];

  let best = running;
  let bestAt = 0;
  for (let y = window; y < height; y += 1) {
    running += ink[y] - ink[y - window];
    if (running > best) {
      best = running;
      bestAt = y - window + 1;
    }
  }

  // A band with no ink in it is a blank page, not a staff too small to see.
  return best / window > 0.02 ? { from: bestAt, to: bestAt + window } : null;
}

/**
 * The shortest repeating period in a band, by autocorrelation.
 *
 * **Shortest, not strongest, and judged on its own height rather than against
 * the tallest peak — and it has to actually be a peak.** Autocorrelation peaks at every *multiple* of the true
 * period, and on a page of music the tallest peak is usually not the staff at
 * all — it is the pitch from one system to the next, seven times wider.
 * Answering with that reports a staff seven times better resolved than it is,
 * which flatters a page instead of warning about it.
 *
 * The first version asked for the shortest lag reaching 80% of the tallest
 * peak, and that is the wrong shape of test. Measured on a real capture of a
 * page at four pixels between staff lines: lag 4 scored **0.662** and the
 * system pitch at lag 28 scored **0.929**, so the true period sat at 71% of
 * the tallest and was rejected by a whisker — while every multiple of 4 that
 * the page also contains (8, 12, 16, 20) sat around 0.28. The staff peak was
 * plainly a peak; it was only unimpressive *relative to something else*.
 *
 * So the bar is absolute: the shortest lag that is a strong peak in its own
 * right. `STRONG_PEAK` is what "strong" means, and it is deliberately high —
 * this rule biases towards *smaller* answers, which is the direction that
 * produces warnings, so a loose bar here is how the app would start talking
 * musicians out of good photographs.
 *
 * **The word "peak" was in that paragraph and not in the code, and it is the
 * whole difference.** Until 2026-09-04 this returned the shortest lag merely
 * *above* `STRONG_PEAK`, which on a drawing is the same thing and on a
 * photograph is not. A real page's ink profile is smooth — neighbouring rows
 * share stems, beams, ledger lines and sensor noise — so the correlation
 * leaves lag 0 on a broad shoulder that is still above 0.5 several rows out.
 * This answered with the first lag on that shoulder: 3, on pages the server
 * measures at 9.25 and 11, and the musician was shown "Too far away to read
 * the notes" about music the pipeline reads correctly. The synthetic pages in
 * `legibility.test.ts` have no shoulder to fall down — five rows of ink on
 * clean paper decorrelate at once — so every case there passed.
 *
 * Requiring a local maximum is what `_staff_peak` in
 * `backend/app/services/page_image.py` has always done, and this is now the
 * same shape of test as the one it must not contradict.
 * `legibility.contract.test.ts` measures both sides on the same pages.
 */
function strongestPeriod(ink: Float64Array, from: number, to: number): number | null {
  const rows = ink.subarray(from, to);
  const n = rows.length;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += rows[i];
  mean /= n;

  let energy = 0;
  for (let i = 0; i < n; i += 1) energy += (rows[i] - mean) ** 2;
  if (energy <= 0) {
    return null;
  }

  const limit = Math.min(MAX_PERIOD, Math.floor(n / 3));
  const at = (lag: number): number => {
    let sum = 0;
    for (let i = 0; i + lag < n; i += 1) {
      sum += (rows[i] - mean) * (rows[i + lag] - mean);
    }
    return sum / energy;
  };

  // One lag of history and one of lookahead, so a lag can be tested for being
  // a maximum rather than merely a large number. Walking outward from
  // `MIN_PERIOD - 1` keeps the answer the shortest qualifying period.
  let before = at(MIN_PERIOD - 1);
  let here = at(MIN_PERIOD);
  for (let lag = MIN_PERIOD; lag <= limit; lag += 1) {
    const after = at(lag + 1);
    if (here >= STRONG_PEAK && here > before && here >= after) {
      return lag;
    }
    before = here;
    here = after;
  }
  return null;
}

/** What to say about a page, given what could be measured of it. */
export function legibilityOf(samples: PageSamples | null): Legibility {
  const spacing = samples ? staffSpacing(samples) : null;
  if (spacing === null) {
    return { verdict: 'unknown', spacing: null };
  }
  return spacing < CLIENT_FLOOR
    ? { verdict: 'tooSmall', spacing }
    : { verdict: 'ok', spacing };
}

/**
 * How many pixels of staff spacing one row of a photographed page is worth.
 *
 * Two measurements of the same real page, both already recorded in this
 * repository: 25 px between staff lines at 4284x5712 (25/5712 = 0.00438), and
 * 4 px at 1280x960 (4/960 = 0.00417). They agree to within 5%, which is what
 * makes the number usable — it is a property of engraved music on a page, not
 * of one camera.
 *
 * The larger of the two is deliberate. It gives the smallest page height that
 * could clear the floor, so `MIN_PAGE_ROWS` is the *optimistic* bound and the
 * app only blames the camera when even a generous reading says the camera is
 * the problem.
 */
const SPACING_PER_PAGE_ROW = 25 / 5712;

/**
 * The shortest photograph of a whole page that could clear the server's floor.
 *
 * Under this, framing is not the variable. A musician who has already filled
 * the frame cannot fill it harder, and "move in until one page fills the frame"
 * becomes advice they have followed and will be given again — which is the
 * failure this project has written down before: **advice must be followable**.
 * The web build is where this bites. A browser hands the page whatever stream
 * it feels like, `captureImage` draws its canvas at exactly that size, and no
 * amount of asking changes what Safari decides to give.
 */
export const MIN_PAGE_ROWS = Math.ceil(SERVER_FLOOR / SPACING_PER_PAGE_ROW);

/**
 * Which way out of a page that will not read.
 *
 * `retake` is the same camera, closer. `cameraApp` is the phone's own camera
 * app, which is not subject to the browser's stream size and returns the
 * sensor's full picture.
 */
export type AdviceRoute = 'retake' | 'cameraApp';

export interface Advice {
  /**
   * The finding, in one clause and in a musician's terms.
   *
   * **Split from the remedy on 2026-09-16**, when the scanner started drawing
   * a verdict on every shot rather than a single line on a bad one. The screen
   * wants the finding large and the remedy under it, and it was deriving the
   * finding by paraphrasing this string — so the page said "Too far away to
   * read the notes" and then, in smaller type underneath, "Too far away to
   * read the notes. Move in until…". One sentence in two places is how that
   * happens; the split makes the pair a single piece of copy again.
   */
  headline: string;
  /** What to change, and what to do next. */
  body: string;
  route: AdviceRoute;
}

/**
 * What to say about a page that will not read, or null for one that might.
 *
 * Names the thing to change, not the thing that is wrong: "too small to read"
 * describes the file, and the musician is holding a camera.
 *
 * **Two different problems produce the same measurement**, and the advice for
 * one is useless for the other. A page photographed from across the desk has
 * plenty of pixels and too little page in them: move in. A page photographed
 * through a stream the browser capped has filled the frame already and still
 * has too few pixels: nothing the musician does at the shutter can help, and
 * the way out is the camera app. `pageRows` — the height in pixels of the
 * rectangle that will actually be uploaded — is what separates them.
 *
 * Omitting `pageRows` gives the old behaviour: without knowing the size of the
 * photograph, "move in" is the safer of the two, because it is at least always
 * true that a closer page is easier to read.
 */
export function adviceFor(
  legibility: Legibility,
  pageRows?: number,
): Advice | null {
  if (legibility.verdict !== 'tooSmall') {
    return null;
  }
  if (typeof pageRows === 'number' && pageRows > 0 && pageRows < MIN_PAGE_ROWS) {
    return {
      // It has to say *the camera*, not you — and the body has to head off the
      // thing a musician would otherwise try next, which is the advice the
      // other branch gives.
      headline: 'This camera can’t see the notes',
      body: 'Try your phone’s camera app.',
      route: 'cameraApp',
    };
  }
  return {
    headline: 'Too far away',
    body: 'Fill the frame with one page.',
    route: 'retake',
  };
}
