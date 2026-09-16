import type { ScoreJson } from '../../data/types';

/**
 * Every bar of a reading, as something you can look at rather than scroll.
 *
 * **The picker was a list of seventy rows.** A bar is found by its number, so
 * a list was the obvious shape — and it meant finding the bar that was wrong
 * required already knowing which one it was. A grid puts sixteen on a screen
 * at once, and an outlier is then a *shape*: a bar holding two notes where its
 * neighbours hold eight stands out before any check has run on it.
 *
 * That is the whole argument, and it is why the note count is on the cell. The
 * beat check catches a bar whose durations do not sum; it is blind to two
 * compensating errors, and blind to a bar the reader simply skipped half of.
 * The count is not a verdict, and a musician reading their own part knows what
 * an eight-note bar looks like in it.
 */

export interface BarCell {
  /** 1-based, as printed on the part. */
  number: number;
  /** How many notes and rests the reading put in it. */
  notes: number;
  /** Whether the beat check could not make this bar add up. */
  flagged: boolean;
  /** What a screen reader says, which has to carry what the shape shows. */
  label: string;
}

export function barCells(
  score: ScoreJson | null | undefined,
  problemMeasures: readonly number[] = [],
): BarCell[] {
  const flagged = new Set(problemMeasures);
  return (score?.measures ?? []).map((measure) => {
    const notes = measure.notes.length;
    const isFlagged = flagged.has(measure.measure_number);
    return {
      number: measure.measure_number,
      notes,
      flagged: isFlagged,
      // The count, then the finding. A screen reader gets the cell in the
      // order the eye takes it, and "does not add up" last so it is the thing
      // left ringing.
      label: `Bar ${measure.measure_number}, ${notes} ${notes === 1 ? 'note' : 'notes'}${
        isFlagged ? ', does not add up' : ''
      }`,
    };
  });
}

/**
 * The line above the grid: how many bars, and how many are in doubt.
 *
 * **Only when there are any.** A sheet that always says "0 bars need
 * attention" teaches a musician that the line means nothing, which is the same
 * failure the pre-flight screen's three static tips had.
 */
export function barGridSummary(cells: BarCell[]): string {
  const flagged = cells.filter((cell) => cell.flagged).length;
  const bars = cells.length === 1 ? '1 bar' : `${cells.length} bars`;
  // **It says what the second number is.** A cell reading "6" over "4" is two
  // numbers and only one of them is self-evident; the screen reader was told
  // ("Bar 6, 4 notes") and the eye was not. Once, above the grid, rather than a
  // unit on seventy cells.
  const what = `${bars}, showing the notes read in each.`;
  if (flagged === 0) {
    return `${what} Tap one to correct it.`;
  }
  return flagged === 1
    ? `${what} The outlined one does not add up.`
    : `${what} The ${flagged} outlined ones do not add up.`;
}
