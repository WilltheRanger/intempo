import type { StavePage } from './pages';

/** As much of an engraved system as knowing which bars are on it needs. */
export interface SystemBars {
  measureSpans: { measureNumber: number }[];
}

/** The first and last bar printed on a page. */
export interface BarRange {
  first: number;
  last: number;
}

/**
 * Which system a bar is printed on — the first, when it spans a break.
 *
 * A bar cut by a line break appears on both systems, and the one a musician
 * looks for is where it starts. `-1` when nothing here holds it, which is what
 * a measure of rests looks like on a picker that only offers bars that sound.
 */
export function systemOfMeasure(systems: SystemBars[], measure: number): number {
  return systems.findIndex((system) =>
    system.measureSpans.some((span) => span.measureNumber === measure),
  );
}

/**
 * The bars on each page, in the order the pages come.
 *
 * A page whose systems carry no bar numbers at all — nothing but a multi-bar
 * rest the engraver could not number, say — returns `null` rather than a range
 * of zeroes: the readout then says nothing instead of saying something wrong.
 */
export function barsOnPages(
  systems: SystemBars[],
  pages: StavePage[],
): (BarRange | null)[] {
  return pages.map((page) => {
    const numbers = systems
      .slice(page.from, page.to)
      .flatMap((system) => system.measureSpans.map((span) => span.measureNumber));

    if (numbers.length === 0) {
      return null;
    }
    return { first: Math.min(...numbers), last: Math.max(...numbers) };
  });
}

/**
 * The line under the music: which bars you are looking at, and where you are.
 *
 * It answers the question the picker is for — *is bar 40 ahead of me or behind
 * me* — which a page number alone does not. One page needs neither half: the
 * music is all on screen, and a line saying "page 1 of 1" is a line that earns
 * nothing (§3 law 10).
 *
 * An en dash for the range, because it is a range and not a subtraction.
 */
export function pageReadout(
  bars: BarRange | null,
  index: number,
  total: number,
): string | null {
  if (total <= 1) {
    return null;
  }

  const place = `Page ${index + 1} of ${total}`;
  if (!bars) {
    return place;
  }
  const range =
    bars.first === bars.last ? `Bar ${bars.first}` : `Bars ${bars.first}–${bars.last}`;
  return `${range} · ${place}`;
}
