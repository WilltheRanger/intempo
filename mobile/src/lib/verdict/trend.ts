import type {
  MeasureVerdict,
  TakeIntonation,
  TempoBeatUnit,
  Tolerance,
} from '../../data/types';
import type { ColorToken } from '../../design';
import {
  FALLBACK_INNER_PCT,
  FALLBACK_OUTER_PCT,
  bandFor,
  displayTempoBpm,
  displayTempoValue,
  verdictColorFor,
} from '../tempo';
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
  /** The band: inside it the line is ink. */
  low: number;
  high: number;
  /** Past these the line is red rather than gold. */
  farLow: number;
  farHigh: number;
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
  // Where `bandFor` stops calling it slight: gold inside, red beyond.
  const far = (sign: 1 | -1) =>
    (tolerance === null
      ? FALLBACK_OUTER_PCT / 2
      : sign > 0
        ? tolerance.rushing_mid_pct
        : tolerance.dragging_mid_pct) / 100;

  const band = measures.map((m, i) => {
    const target = barTarget(m, takeTarget);
    return {
      at: along(i, count),
      // Unrounded: a whole-beat edge would put the colour change up to half
      // a beat from where the tolerance actually is, and step the line.
      centre: displayTempoValue(target, unit),
      low: displayTempoValue(target * (1 - inner(-1)), unit),
      high: displayTempoValue(target * (1 + inner(1)), unit),
      farLow: displayTempoValue(target * (1 - far(-1)), unit),
      farHigh: displayTempoValue(target * (1 + far(1)), unit),
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
      value: displayTempoValue(value, unit),
      tone: tier === 'on' ? null : verdictColorFor(tier),
    };
  });
  const runs = runsOf(points);
  const { min, max } = range([
    ...runs.flat().map((p) => p.value),
    ...band.flatMap((b) => [b.low, b.high]),
  ]);
  return {
    runs,
    band,
    min,
    max,
    centreLabel: String(displayTempoBpm(barTarget(measures[0], takeTarget), unit)),
  };
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
    farLow: -take.slightCents,
    farHigh: take.slightCents,
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

/** A point on the graph, in its own pixels. */
export interface PlotPoint {
  x: number;
  y: number;
}

const px = (n: number) => Math.round(n * 100) / 100;

/**
 * The line through a run of points as one smooth curve (the owner,
 * 2026-09-29: the straight segments read as a spreadsheet).
 *
 * **Monotone cubic (Fritsch–Carlson), not a spline that is merely smooth.**
 * An ordinary curve through these points overshoots: between a bar at 104 and
 * one at 106 it would bulge to 107, drawing a rush nobody played. This one
 * never goes above or below the two bars it joins, so every height on the line
 * is one the take actually reached.
 */
export function smoothPath(points: readonly PlotPoint[]): string {
  if (points.length === 0) return '';
  const first = points[0];
  if (points.length === 1) return `M ${px(first.x)},${px(first.y)}`;
  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(points[i + 1].x - points[i].x);
    slope.push(dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i]);
  }
  const tangent: number[] = new Array(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    // A peak or a trough is flat on top, which is what keeps it from overshooting.
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const size = a * a + b * b;
    if (size > 9) {
      const k = 3 / Math.sqrt(size);
      tangent[i] = k * a * slope[i];
      tangent[i + 1] = k * b * slope[i];
    }
  }
  let d = `M ${px(first.x)},${px(first.y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const third = dx[i] / 3;
    d +=
      ` C ${px(from.x + third)},${px(from.y + tangent[i] * third)}` +
      ` ${px(to.x - third)},${px(to.y - tangent[i + 1] * third)}` +
      ` ${px(to.x)},${px(to.y)}`;
  }
  return d;
}

/**
 * Everything above and below the band, as one shape to clip to — so the line
 * turns gold exactly where it crosses the band's edge rather than at the next
 * bar, and red exactly where it crosses the far edge.
 *
 * Two closed regions, each running along the band's edge and out past the
 * graph's top or bottom, following the target where the page changes tempo.
 */
export function outsidePath(
  band: readonly TrendBand[],
  edge: 'near' | 'far',
  toX: (at: number) => number,
  toY: (value: number) => number,
  height: number,
): string {
  if (band.length === 0) return '';
  const high = band.map((b) => ({ x: toX(b.at), y: toY(edge === 'near' ? b.high : b.farHigh) }));
  const low = band.map((b) => ({ x: toX(b.at), y: toY(edge === 'near' ? b.low : b.farLow) }));
  const left = high[0].x;
  const right = high[high.length - 1].x;
  const above = -height;
  const below = height * 2;
  const along = (points: { x: number; y: number }[]) =>
    points.map((p) => `L ${px(p.x)},${px(p.y)}`).join(' ');
  return (
    `M ${px(left)},${px(above)} L ${px(right)},${px(above)} ${along([...high].reverse())} Z ` +
    `M ${px(left)},${px(below)} L ${px(right)},${px(below)} ${along([...low].reverse())} Z`
  );
}
