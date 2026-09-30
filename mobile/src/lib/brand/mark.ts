import geometry from '../../design/brandMark.json';

/**
 * InTempo's mark, "Settle" (the owner, 2026-09-30): a line that swings less
 * each time until it settles into a band, ending in a gold dot — the app's own
 * tempo graph. The geometry is `design/brandMark.json`, which
 * `tools/draw-brand-assets.py` draws the icons from too, so the mark on the
 * opening screen is the icon the musician just tapped.
 */

export const MARK = geometry;

/** The curve as an SVG path, in the mark's 100-unit box. */
export function markPath(): string {
  const [x, y] = MARK.curve.start;
  return [
    `M ${x} ${y}`,
    ...MARK.curve.segments.map(
      ([c1x, c1y, c2x, c2y, ex, ey]) => `C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`,
    ),
  ].join(' ');
}

/**
 * The curve's length in the mark's units, measured by walking it — what a
 * stroke drawn from nothing to whole has to cover.
 */
export function markLength(steps = 64): number {
  let [px, py] = MARK.curve.start;
  let length = 0;
  for (const [c1x, c1y, c2x, c2y, ex, ey] of MARK.curve.segments) {
    const [sx, sy] = [px, py];
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const u = 1 - t;
      const x = u ** 3 * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * ex;
      const y = u ** 3 * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * ey;
      length += Math.hypot(x - px, y - py);
      [px, py] = [x, y];
    }
  }
  return length;
}

/** How long the line takes to draw itself when the app opens. */
export const DRAW_MS = 900;
/** How long after that the dot lands. */
export const DOT_DELAY_MS = 750;
/**
 * The dot's pulse while the account loads: sixty to the minute, a metronome
 * at rest — alive, without a spinner.
 */
export const PULSE_MS = 1000;
/** When the opening screen admits it is taking a while. */
export const WAKING_AFTER_MS = 3000;

/**
 * The one line the opening screen ever shows, and when (the owner, 2026-09-30,
 * S1): nothing at first, because most opens are quick and a sentence read in
 * half a second is a sentence nobody needed; "Waking up…" once it is slow,
 * which after a quiet spell is the server starting.
 */
export function openingLine(elapsedMs: number): string | null {
  return elapsedMs >= WAKING_AFTER_MS ? 'Waking up…' : null;
}

/** One moment of the opening animation. */
export interface MarkFrame {
  /** How much of the line is drawn, 0 to 1. */
  drawn: number;
  /** The band's opacity, as a share of its own. */
  band: number;
  dotScale: number;
  dotOpacity: number;
}

/** The mark at rest: what reduced motion shows, and every icon is. */
export const RESTING: MarkFrame = { drawn: 1, band: 1, dotScale: 1, dotOpacity: 1 };

/** How much larger the dot grows at the top of each beat. */
const PULSE_GROW = 0.16;

/** How long the dot takes to land once its delay is over. */
const DOT_LAND_MS = 260;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * The mark `elapsedMs` into opening: the band fades up, the line draws itself
 * across it and settles, the dot lands where it settled — and then pulses at
 * sixty to the minute for as long as the account takes to load.
 */
export function markFrame(elapsedMs: number): MarkFrame {
  const landed = clamp((elapsedMs - DOT_DELAY_MS) / DOT_LAND_MS);
  const since = elapsedMs - DOT_DELAY_MS - DOT_LAND_MS;
  // **A beat in size, not in brightness.** The line's end sits under the dot,
  // and dimming it let the ivory through — a gold dot pulsing to tan.
  const beat = since > 0 ? (PULSE_GROW * (1 - Math.cos((2 * Math.PI * since) / PULSE_MS))) / 2 : 0;
  return {
    drawn: easeOut(clamp(elapsedMs / DRAW_MS)),
    band: easeOut(clamp(elapsedMs / 300)),
    dotScale: landed === 0 ? 0 : 0.5 + 0.5 * easeOut(landed) + beat,
    dotOpacity: easeOut(landed),
  };
}
