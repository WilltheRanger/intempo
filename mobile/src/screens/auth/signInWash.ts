/**
 * Where the Sign in screen's ivory wash sits over the photograph
 * (`redesign/SignIn.dc.html`).
 *
 * The prototype fixes it: clear at the top, solid ivory from 38% of the height
 * down, with the form stood on the solid part. That holds on the phone it was
 * drawn for and on nothing shorter — at 667pt the form starts well above 38%,
 * so the email field and its label were on the turntable. And the form is not
 * one height: an error line, the legal sentence, a lede that wraps.
 *
 * So the wash keeps the prototype's curve and follows the form: solid from a
 * little above the form's title, or from the prototype's 38% if that is
 * higher, and the fade above it the prototype's length.
 */

/** Where the prototype's wash turns solid, as a fraction of the height. */
export const SOLID_FROM = 0.38;

/**
 * The prototype's fade, from clear to solid, as distances above the solid
 * point in fractions of the height, and the ivory at each.
 */
const FADE: ReadonlyArray<readonly [above: number, wash: number]> = [
  [0.38, 0],
  [0.26, 0.06],
  [0.17, 0.3],
  [0.1, 0.68],
  [0.05, 0.92],
  [0, 1],
];

/**
 * Solid ground above the form's title, in points — the prototype's own
 * margin: solid at 38% of 844 is 321, and its title starts at about 365.
 */
const LEAD = 44;

export type WashStop = [offset: number, opacity: number];

/**
 * The gradient's stops for a screen `height` points tall whose form starts
 * title starts `formTop` points down — or the prototype's own, when either is
 * unknown.
 */
export function signInWash(height: number, formTop: number | null): WashStop[] {
  let solid = SOLID_FROM;
  if (height > 0 && formTop !== null) {
    solid = Math.max(0, Math.min(SOLID_FROM, (formTop - LEAD) / height));
  }
  const stops: WashStop[] = [];
  for (const [above, wash] of FADE) {
    const offset = solid - above;
    if (offset > 0) {
      stops.push([round(offset), wash]);
    }
  }
  // A wash that starts above the top of the screen starts part-way: clear
  // ground there would be a band the fade never reached.
  const first = stops[0];
  stops.unshift([0, first && first[0] > 0 ? firstWash(solid) : 1]);
  stops.push([1, 1]);
  return stops;
}

/** The ivory at the very top of the screen, read off the fade. */
function firstWash(solid: number): number {
  for (let i = 1; i < FADE.length; i += 1) {
    const [aboveNear, washNear] = FADE[i];
    const [aboveFar, washFar] = FADE[i - 1];
    if (solid <= aboveFar && solid >= aboveNear) {
      const t = (aboveFar - solid) / (aboveFar - aboveNear);
      return round(washFar + (washNear - washFar) * t);
    }
  }
  return 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
