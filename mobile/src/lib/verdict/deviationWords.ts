import type { Direction } from '../../data/types';

/**
 * How far off the beat a measure was, in words a musician uses.
 *
 * **The figure behind a tapped row was `+18%`.** A percentage of one beat is
 * what the pipeline computes and it is not a thing anyone has ever felt while
 * playing — nobody comes off a take thinking they were eighteen percent early.
 * The number was precise, honest, and useless at the moment it was read, which
 * is the moment a musician is deciding whether to play the passage again.
 *
 * **A share of a beat is the same fact in the musician's own currency.**
 * `MeasureVerdict.deviationPct` is already a percentage *of one beat*, so the
 * conversion is exact rather than a rescaling: 25 is a quarter of a beat, 50 is
 * half of one. What changes is that the reader can hear it.
 *
 * **Quarters, halves and whole beats, and nothing finer.** Not "an eighth of a
 * beat", which reads as an eighth note and on a quarter-note beat means a
 * thirty-second; not "a tenth", which sounds measured to a precision the
 * pipeline does not have. Everything under a quarter of a beat is *barely*,
 * because that is what it is: below the band where a listener hears a note as
 * early rather than as slightly uneven.
 *
 * The bands overlap the verdict's own on purpose. The word in the row —
 * "Slight rush", "Rushing" — says how it was judged; this says how much, and
 * the two are different questions about the same bar.
 */

/**
 * Edges in percent of a beat, each paired with what is said at or below it.
 *
 * Ordered, and read in order. A table rather than a chain of `if`s so the
 * boundaries can be seen at once and tested one at a time.
 */
const BANDS: { upTo: number; words: (way: Way) => string }[] = [
  // The only band that names the beat itself, because it is the only one whose
  // words do not already contain the word. "About a quarter of a beat ahead of
  // the beat" was the first draft and it says beat twice.
  { upTo: 12, words: (way) => `Barely ${way.ofTheBeat}` },
  { upTo: 37, words: (way) => `About a quarter of a beat ${way.short}` },
  { upTo: 70, words: (way) => `About half a beat ${way.short}` },
  { upTo: 130, words: (way) => `About a whole beat ${way.short}` },
  { upTo: Infinity, words: (way) => `More than a beat ${way.short}` },
];

/**
 * Which way, in the word a musician would use.
 *
 * "Ahead" and "behind" rather than "rushing" and "dragging": those two are
 * judgements and the row already carries one. This sentence is about position.
 */
interface Way {
  /** Beside a fraction that has already said "beat". */
  short: string;
  /**
   * On its own. The preposition is not shared: it is "ahead **of** the beat"
   * and "behind the beat", and treating them as one string with a prefix
   * produced "Barely behind of the beat".
   */
  ofTheBeat: string;
}

function way(direction: Direction): Way {
  return direction === 'rush'
    ? { short: 'ahead', ofTheBeat: 'ahead of the beat' }
    : { short: 'behind', ofTheBeat: 'behind the beat' };
}

/**
 * The full phrase for one measure, or null when there is nothing to say.
 *
 * Null at a deviation of zero — not "barely ahead of the beat", which is the
 * app finding a fault in a bar it just called on tempo. A take can land on the
 * beat, and the row's own word already says so.
 */
export function deviationWords(
  deviationPct: number,
  direction: Direction,
): string | null {
  const size = Math.abs(deviationPct);
  if (size < 1) {
    return null;
  }
  const band = BANDS.find((entry) => size <= entry.upTo);
  return band ? band.words(way(direction)) : null;
}
