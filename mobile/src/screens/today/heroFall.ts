/**
 * Where Today's ivory fall sits over the photograph (`PracticeHero`).
 *
 * The prototype (`redesign/TodayLight.dc.html`) fixes it at 47% to 75% of the
 * height, which is right for its sample — a one-line title and nothing under
 * it. A real piece is a two-line title, its composer and tempo, and a sentence
 * about the last take, and that block starts near 47%: exactly where the fall
 * begins, so the label and the title were drawn on the photograph.
 *
 * So the fall keeps the prototype's shape and follows the copy: it is moved up
 * until it has settled by the copy's first line, and never lower than the
 * prototype put it.
 *
 * **Its run is shorter than the prototype's**, because following the copy
 * with the prototype's 28% took the wash up to about a quarter of the way
 * down the screen, and the owner's answer (2026-09-23) was that it "creeps up
 * too high". The copy's first line still needs settled ivory, so the fall
 * cannot start later; it can finish sooner, and a 20% run left the room in
 * the photograph about 70pt deeper for the same contrast under the label.
 *
 * **17% since 2026-09-24**, when the owner asked for more of the image again,
 * with the copy lowered 28pt at the same time. The two together start the
 * fall about 45pt further down a 390×844 screen, and the label still sits on
 * ivory settled to `SETTLED_WASH`: that is placed from the copy, not from here.
 */

/** The prototype's `fadeStart`, as a fraction of the height. */
export const FALL_START = 0.47;
/** The run from where the fall starts to where it is fully ivory, as a fraction. */
export const FALL_SPAN = 0.17;

/**
 * The prototype's curve: along the run (0 to 1), how much ivory is laid over
 * the photograph.
 */
const CURVE: ReadonlyArray<readonly [along: number, wash: number]> = [
  [0, 0],
  [0.18, 0.31],
  [0.38, 0.75],
  [0.6, 0.865],
  [0.8, 0.94],
  [1, 0.984],
];

/**
 * How settled the ground must be under the first line of copy: the curve's
 * 0.865 point. At that wash the darkest part of the room composites to about
 * `#D8D4CD`, where the label's `textSecondary` measures 4.8:1; at 0.75 it is
 * about 4:1, which is why it is this point and not an earlier one.
 */
export const SETTLED_WASH = 0.865;
const SETTLED_ALONG = 0.6;

/** Room between the settled point and the copy, in points. */
const LEAD = 8;

/**
 * The highest the fall may start. Above this it would reach the greeting,
 * which is ivory on the photograph and needs the photograph dark behind it.
 */
export const MIN_START = 0.2;

export type FallStop = [offset: number, opacity: number];

/**
 * The gradient's stops for a hero `height` points tall whose copy starts
 * `copyTop` points down, or the prototype's own stops when either is unknown.
 */
export function fallStops(height: number, copyTop: number | null): FallStop[] {
  let start = FALL_START;
  if (height > 0 && copyTop !== null) {
    const settleBy = (copyTop - LEAD) / height;
    start = Math.max(MIN_START, Math.min(FALL_START, settleBy - SETTLED_ALONG * FALL_SPAN));
  }
  const stops: FallStop[] = [[0, 0]];
  for (const [along, wash] of CURVE) {
    stops.push([round(start + along * FALL_SPAN), wash]);
  }
  stops.push([1, 1]);
  return stops;
}

/** The wash at a fraction `at` of the height, read off `stops`. */
export function washAt(stops: readonly FallStop[], at: number): number {
  for (let i = 1; i < stops.length; i += 1) {
    const [x1, y1] = stops[i];
    if (at <= x1) {
      const [x0, y0] = stops[i - 1];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (at - x0)) / (x1 - x0);
    }
  }
  return stops[stops.length - 1][1];
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
