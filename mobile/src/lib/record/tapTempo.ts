/**
 * The Tempo screen's rules (`redesign/Tempo.dc.html`): tap tempo, the range of
 * the bar, and the quick picks.
 *
 * All in the tempo a musician counts — the page's beat unit, what
 * `displayTempoBpm` returns — because that is the pulse they tap and the number
 * the page prints. The screen converts to the quarter-note clock only when it
 * stores the result.
 */

/** How many taps the average is taken over: the last six. */
export const TAP_WINDOW = 6;

/** A pause this long between taps starts a new count. */
export const TAP_RESET_MS = 2000;

/** The redesign's bar runs from 40 to 160. */
export const TEMPO_FLOOR = 40;
export const TEMPO_CEILING = 160;

/**
 * The bar's ends.
 *
 * 40 to 160, as drawn — **widened, never narrowed, to reach a tempo the piece
 * actually has.** A caprice marked 176 must be settable at its own marking; a
 * slider that clamps it to 160 would move the musician's tempo the moment
 * they touched it. Widened to a round ten so the end labels stay clean.
 */
export function tempoBounds(
  ...values: (number | null | undefined)[]
): { min: number; max: number } {
  const real = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const low = Math.min(TEMPO_FLOOR, ...real);
  const high = Math.max(TEMPO_CEILING, ...real);
  return {
    min: low < TEMPO_FLOOR ? Math.floor(low / 10) * 10 : TEMPO_FLOOR,
    max: high > TEMPO_CEILING ? Math.ceil(high / 10) * 10 : TEMPO_CEILING,
  };
}

export function clampTempo(bpm: number, bounds: { min: number; max: number }): number {
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(bpm)));
}

/** The tempo at a point along the bar, `fraction` from 0 (left) to 1. */
export function tempoAtFraction(
  fraction: number,
  bounds: { min: number; max: number },
): number {
  const f = Math.max(0, Math.min(1, fraction));
  return clampTempo(bounds.min + f * (bounds.max - bounds.min), bounds);
}

/** Where `bpm` sits along the bar, 0 to 1. */
export function fractionOf(bpm: number, bounds: { min: number; max: number }): number {
  const span = bounds.max - bounds.min;
  return span > 0 ? Math.max(0, Math.min(1, (bpm - bounds.min) / span)) : 0;
}

/**
 * The taps to keep after one more at `now` (milliseconds).
 *
 * A gap longer than `TAP_RESET_MS` since the last tap starts over — someone
 * who stops, listens and taps again is counting a new tempo, and averaging it
 * with the old one would give neither.
 */
export function recordTap(taps: readonly number[], now: number): number[] {
  const last = taps[taps.length - 1];
  const kept = last !== undefined && now - last > TAP_RESET_MS ? [] : [...taps];
  kept.push(now);
  return kept.slice(-TAP_WINDOW);
}

/** The tempo the taps describe, or null until there are two of them. */
export function tappedBpm(
  taps: readonly number[],
  bounds: { min: number; max: number },
): number | null {
  if (taps.length < 2) {
    return null;
  }
  const span = taps[taps.length - 1] - taps[0];
  const average = span / (taps.length - 1);
  return average > 0 ? clampTempo(60000 / average, bounds) : null;
}

/** What the tap button says, by how many taps are in the current count. */
export function tapLabel(count: number): string {
  return count === 0 ? 'Tap tempo' : count === 1 ? 'Keep tapping' : 'Tapping';
}

export interface QuickPick {
  key: 'half' | 'threeQuarters' | 'marked';
  label: string;
  bpm: number;
}

/**
 * Half, three quarters and the marked tempo — the steps a musician usually
 * works a piece up through.
 *
 * None without a marked tempo: "Marked · 92" of a page that marks nothing is
 * a number the app made up.
 */
export function quickPicks(
  marked: number | null | undefined,
  bounds: { min: number; max: number },
): QuickPick[] {
  if (typeof marked !== 'number' || !Number.isFinite(marked) || marked <= 0) {
    return [];
  }
  const half = clampTempo(marked / 2, bounds);
  const three = clampTempo(marked * 0.75, bounds);
  const full = clampTempo(marked, bounds);
  return [
    { key: 'half', label: `Half · ${half}`, bpm: half },
    { key: 'threeQuarters', label: `¾ · ${three}`, bpm: three },
    { key: 'marked', label: `Marked · ${full}`, bpm: full },
  ];
}
