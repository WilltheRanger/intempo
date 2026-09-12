import type { TakeResult, Tolerance } from '../../data/types';
import { sharedFullScaleFor } from '../tempo';

/**
 * Recent sessions, as a series a chart can draw.
 *
 * **Insights had one number and one bar**: the thirty-day mean deviation,
 * drawn as a single fill growing from a centre line. That answers "what do you
 * tend to do" and nothing else — it cannot show that the last four sessions
 * have been steadily improving, or that one of them was an outlier, because a
 * mean has no shape. This turns the same window into the shape.
 *
 * A rules module rather than arithmetic inside the chart, per `CLAUDE.md` §3:
 * there is no React Native testing library here (`DECISIONS.md`, 2026-08-24),
 * so which sessions are plotted, which way up they go and which get a dot are
 * all decisions nothing would check if they lived in the `.tsx`.
 */

export interface TrendPoint {
  /** The analysis, so a tap can open that take. */
  id: string;
  /** When it was recorded, ISO. */
  at: string;
  /**
   * Mean drift across the session, percent of a beat, **rush-positive**.
   *
   * The mean of the take's own rolling trend rather than a separate figure, so
   * a point on this chart and the line on that take's verdict screen are the
   * same measurement summarised — two screens disagreeing about one take is a
   * defect this project has already shipped once.
   */
  value: number;
  /** Drawn with a dot and readable on its own. See `NOTABLE`. */
  notable: boolean;
}

export interface SessionTrend {
  /** Oldest first, so the line reads left to right as time. */
  points: TrendPoint[];
  /**
   * Half the plot's height, in percent of a beat.
   *
   * The outer threshold the pipeline judged by — so a point touching the top
   * of the chart means "severe", not "the tallest thing in this data". One
   * scale for both directions, unlike `DeviationBar`; `sharedFullScaleFor`
   * carries that argument.
   */
  fullScale: number;
}

/** Two points make a line; one makes a dot pretending to be a trend. */
const MINIMUM_POINTS = 2;

function meanOf(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Which points earn a dot.
 *
 * **Not every point**, which is the difference between a chart and a list of
 * dots joined up. Three earn one, and each answers a question somebody
 * actually has: the **latest** session, because that is the one they just
 * played; and the **furthest either way**, because those are the sessions
 * worth going back to. A point that is more than one of those is still one
 * dot.
 */
function notableIndices(points: readonly { value: number }[]): Set<number> {
  const marked = new Set<number>([points.length - 1]);

  let highest = 0;
  let lowest = 0;
  points.forEach((point, index) => {
    if (point.value > points[highest].value) {
      highest = index;
    }
    if (point.value < points[lowest].value) {
      lowest = index;
    }
  });

  // Only when they are genuinely apart. A flat series would otherwise get two
  // dots on adjacent points and imply a spread that is not there.
  if (points[highest].value !== points[lowest].value) {
    marked.add(highest);
    marked.add(lowest);
  }

  return marked;
}

/**
 * Build the series, or null when there is not enough to draw honestly.
 *
 * Null rather than an empty chart: an axis with nothing on it reads as "you
 * have no drift", which is a claim, where the caller's empty state reads as
 * "not enough sessions yet", which is the truth.
 */
export function sessionTrendFrom(
  takes: readonly TakeResult[],
  tolerance: Tolerance | null,
): SessionTrend | null {
  const usable = takes
    // **A failed run is not a session at a deviation of zero.** Every field
    // below `failure` is a placeholder when it is set, so plotting one would
    // draw the placeholder as though a musician had played it.
    .filter((take) => take.failure === null && take.trend.length > 0)
    .map((take) => ({ id: take.id, at: take.recordedAt, value: meanOf(take.trend) }))
    .filter((point): point is { id: string; at: string; value: number } => point.value !== null)
    // The API returns newest first; a chart of time reads the other way.
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (usable.length < MINIMUM_POINTS) {
    return null;
  }

  const marked = notableIndices(usable);

  return {
    points: usable.map((point, index) => ({ ...point, notable: marked.has(index) })),
    fullScale: sharedFullScaleFor(tolerance),
  };
}

/**
 * Where a value sits vertically, as 0 (top) to 1 (bottom).
 *
 * **Rush-positive goes up**, which means negating: SVG's y grows downward and
 * "ahead of the beat" is the top of every other tempo drawing in this app.
 * Clamped, because a session past the outer threshold is off the chart by
 * definition and a line leaving the box is worse than one touching its edge.
 */
export function plotFraction(value: number, fullScale: number): number {
  if (!(fullScale > 0)) {
    return 0.5;
  }
  const clamped = Math.max(-1, Math.min(1, value / fullScale));
  return 0.5 - clamped / 2;
}
