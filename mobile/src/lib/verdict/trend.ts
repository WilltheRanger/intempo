import type {
  MeasureVerdict,
  TakeIntonation,
  TempoBeatUnit,
  Tolerance,
} from '../../data/types';
import type { ColorToken } from '../../design';
import { FALLBACK_INNER_PCT, bandFor, displayTempoBpm, verdictColorFor } from '../tempo';
import { barTarget } from './barTempo';
import { pitchBand, pitchTone } from './intonation';
import { readMeasure } from './measureReading';

/**
 * The result screen's graph: the take as a line across an on-tempo band.
 *
 * **A trend, not a bar-by-bar measurement** (the owner, 2026-09-29: "the bar
 * by bar measurement in general doesn't make sense … like a graph … to show
 * the trend"). One bar is a handful of notes, so its own tempo is the
 * shakiest figure the app has; a line smoothed over its neighbours shows what
 * a musician actually asks — did I speed up, where, and did I come back — and
 * the band around the target shows how much is too much. The line is ink
 * inside the band and takes the verdict's gold or red only where it leaves it.
 *
 * Pitch is the same picture: cents off the player's own tuning, the band the
 * take's in-tune distance either side of it.
 */

export interface TrendPoint {
  measure: number;
  /** Along the take, 0 at its first bar and 1 at its last. */
  at: number;
  /** Smoothed: the bar and its neighbours on either side. */
  value: number;
  /** Null inside the band; the verdict colour of how far out it is otherwise. */
  tone: ColorToken | null;
}

export interface TrendBand {
  at: number;
  centre: number;
  low: number;
  high: number;
}

export interface TrendData {
  /** Runs of bars with a value; a bar without one breaks the line. */
  runs: TrendPoint[][];
  /** The band along the take, following the target where the page moves it. */
  band: TrendBand[];
  /** The value range the graph is drawn over, padded. */
  min: number;
  max: number;
  /** The target at the start, for the label on its line ("96"); null for pitch. */
  centreLabel: string | null;
}

/** Each value the mean of itself and its neighbours in the same run. */
function smooth(values: readonly (number | null)[]): (number | null)[] {
  return values.map((value, i) => {
    if (value === null) return null;
    const around = [values[i - 1], value, values[i + 1]].filter(
      (v): v is number => v !== null && v !== undefined,
    );
    return around.reduce((sum, v) => sum + v, 0) / around.length;
  });
}

function along(index: number, count: number): number {
  return count <= 1 ? 0.5 : index / (count - 1);
}

function runsOf(points: readonly (TrendPoint | null)[]): TrendPoint[][] {
  const runs: TrendPoint[][] = [];
  let run: TrendPoint[] = [];
  for (const point of points) {
    if (point) {
      run.push(point);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

function range(values: readonly number[]): { min: number; max: number } {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.12, 1);
  return { min: low - pad, max: high + pad };
}

/**
 * The take's tempo as a trend, in the page's beat unit, or null where fewer
 * than two bars carry a tempo — an older result, or a take too short to have
 * a shape.
 */
export function tempoTrend(
  measures: readonly MeasureVerdict[],
  takeTarget: number,
  unit: TempoBeatUnit | null | undefined,
  tolerance: Tolerance | null,
): TrendData | null {
  const played = measures.map((m) =>
    m.playedBpm !== null && m.playedBpm > 0 && readMeasure(m).showsDeviation
      ? m.playedBpm
      : null,
  );
  if (played.filter((v) => v !== null).length < 2) return null;
  const smoothed = smooth(played);
  const count = measures.length;
  const inner = (sign: 1 | -1) =>
    (tolerance === null
      ? FALLBACK_INNER_PCT
      : sign > 0
        ? tolerance.rushing_inner_pct
        : tolerance.dragging_inner_pct) / 100;

  const band = measures.map((m, i) => {
    const target = barTarget(m, takeTarget);
    return {
      at: along(i, count),
      centre: displayTempoBpm(target, unit),
      low: displayTempoBpm(target * (1 - inner(-1)), unit),
      high: displayTempoBpm(target * (1 + inner(1)), unit),
    };
  });
  const points = measures.map((m, i) => {
    const value = smoothed[i];
    if (value === null) return null;
    const target = barTarget(m, takeTarget);
    const tier = bandFor((value / target - 1) * 100, tolerance);
    return {
      measure: m.measure,
      at: along(i, count),
      value: displayTempoBpm(value, unit),
      tone: tier === 'on' ? null : verdictColorFor(tier),
    };
  });
  const runs = runsOf(points);
  const { min, max } = range([
    ...runs.flat().map((p) => p.value),
    ...band.flatMap((b) => [b.low, b.high]),
  ]);
  return { runs, band, min, max, centreLabel: String(band[0].centre) };
}

/** The take's pitch as a trend, in cents against the player's tuning, or null with fewer than two bars read. */
export function takePitchTrend(
  measures: readonly MeasureVerdict[],
  take: TakeIntonation | null,
): TrendData | null {
  if (!take) return null;
  const cents = measures.map((m) => m.pitchCents ?? null);
  if (cents.filter((v) => v !== null).length < 2) return null;
  const smoothed = smooth(cents);
  const count = measures.length;
  const band = measures.map((_, i) => ({
    at: along(i, count),
    centre: 0,
    low: -take.inTuneCents,
    high: take.inTuneCents,
  }));
  const points = measures.map((m, i) => {
    const value = smoothed[i];
    if (value === null) return null;
    const tier = pitchBand(value, take);
    return {
      measure: m.measure,
      at: along(i, count),
      value,
      tone: tier === 'in_tune' ? null : pitchTone(tier),
    };
  });
  const runs = runsOf(points);
  const { min, max } = range([
    ...runs.flat().map((p) => p.value),
    ...band.flatMap((b) => [b.low, b.high]),
  ]);
  return { runs, band, min, max, centreLabel: null };
}

/** Where a value sits on a graph drawn `height` tall, 0 at the top. */
export function trendY(value: number, data: TrendData, height: number): number {
  const span = data.max - data.min;
  return span <= 0 ? height / 2 : ((data.max - value) / span) * height;
}

/** The bar under a point `at` along the take (0 to 1), of `count` bars. */
export function barAtAlong(at: number, count: number): number {
  if (count <= 1) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(at * (count - 1))));
}
