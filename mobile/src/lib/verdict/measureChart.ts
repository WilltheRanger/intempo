import type { MeasureVerdict } from '../../data/types';
import type { ColorToken } from '../../design/colors';
import { readMeasure } from './measureReading';

/**
 * The Verdict screen's "Measure by measure" chart (`redesign/Verdict.dc.html`):
 * one bar per measure, up for ahead of the beat and down for behind, coloured
 * by what the measure was told.
 *
 * It replaces a list of one row per measure, which on a real piece was forty
 * rows to scroll through for the three that mattered. The chart is the whole
 * take at a glance; the one tapped opens underneath.
 */

export interface ChartBar {
  measure: number;
  /** Ahead of the beat — deviations here are rush-positive. */
  up: boolean;
  /** Share of the half-height, 0 to 1, with a floor so on-tempo bars show. */
  size: number;
  /** The measure's verdict colour, or null for one that was not judged. */
  tone: ColorToken | null;
}

/** The smallest bar drawn: on the beat still reads as a bar, not a gap. */
export const MIN_BAR = 0.07;

/**
 * The deviation the half-height stands for: the take's largest, and never
 * less than 10% — or a take that was steady to within a whisker would draw
 * its whisker as a full-height red wall.
 */
const SCALE_FLOOR_PCT = 10;

export function measureChartBars(measures: readonly MeasureVerdict[]): ChartBar[] {
  const judged = measures.filter((m) => readMeasure(m).showsDeviation);
  const scale = Math.max(
    SCALE_FLOOR_PCT,
    ...judged.map((m) => Math.abs(m.deviationPct)),
  );
  return measures.map((measure) => {
    const reading = readMeasure(measure);
    if (!reading.showsDeviation) {
      // Not judged: a neutral stub on the line, because a bar that was not
      // timed has no side of the beat to be on.
      return { measure: measure.measure, up: true, size: MIN_BAR, tone: null };
    }
    return {
      measure: measure.measure,
      up: measure.deviationPct >= 0,
      size: Math.max(MIN_BAR, Math.min(1, Math.abs(measure.deviationPct) / scale)),
      tone: reading.tone,
    };
  });
}

/** The bar under a point `x` across a chart `width` wide with `count` bars. */
export function barIndexAt(x: number, width: number, count: number): number | null {
  if (count <= 0 || width <= 0) {
    return null;
  }
  return Math.max(0, Math.min(count - 1, Math.floor((x / width) * count)));
}
