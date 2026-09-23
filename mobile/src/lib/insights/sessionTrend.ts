import type { TakeResult, Tolerance } from '../../data/types';
import { FALLBACK_INNER_PCT, sharedFullScaleFor } from '../tempo';

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
}

/**
 * The vertical span a take chart draws, in percent of a beat, rush-positive.
 *
 * **Fitted to the takes, not centred on the beat** (`redesign/Insights.dc.html`).
 * A musician who rushes has every point above the line, and a symmetric axis
 * spent half the chart on "behind the beat" with nothing in it — the drift
 * the chart exists to show was drawn in the top half at half the size.
 */
export interface TrendRange {
  /** The value at the top edge and at the bottom edge. */
  top: number;
  bottom: number;
  /**
   * The on-tempo band either side of the beat: the take's own inner
   * thresholds, so a point inside the band is one the pipeline called on
   * tempo.
   */
  bandTop: number;
  bandBottom: number;
}

export interface SessionTrend {
  /** Oldest first, so the line reads left to right as time. */
  points: TrendPoint[];
  range: TrendRange;
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

  return {
    points: usable,
    range: trendRange(
      usable.map((point) => point.value),
      tolerance,
    ),
  };
}

/** Room above the highest point and below the lowest, as a share of the span. */
const HEADROOM = 0.1;

/** How far past the band the span reaches when no take does: a sliver, so the band has an edge. */
const BAND_MARGIN = 1.1;

/**
 * The span for a set of take values: every take and the whole on-tempo band,
 * with a little room past the extremes, and never wider than half again the
 * outer threshold — past that a point is off the chart by definition, and one
 * wild take should not flatten the other thirteen into a line.
 */
export function trendRange(values: readonly number[], tolerance: Tolerance | null): TrendRange {
  const bandTop = tolerance?.rushing_inner_pct ?? FALLBACK_INNER_PCT;
  const bandBottom = -(tolerance?.dragging_inner_pct ?? FALLBACK_INNER_PCT);
  const limit = sharedFullScaleFor(tolerance) * 1.5;
  const high = Math.min(limit, Math.max(bandTop * BAND_MARGIN, ...values));
  const low = Math.max(-limit, Math.min(bandBottom * BAND_MARGIN, ...values));
  const room = (high - low) * HEADROOM;
  return { top: high + room, bottom: low - room, bandTop, bandBottom };
}

/**
 * Where a value sits vertically, as 0 (top) to 1 (bottom).
 *
 * **Rush-positive goes up**, which means negating: SVG's y grows downward and
 * "ahead of the beat" is the top of every other tempo drawing in this app.
 * Clamped, because a line leaving the box is worse than one touching its edge.
 */
export function plotFraction(value: number, range: TrendRange): number {
  const span = range.top - range.bottom;
  if (!(span > 0)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, (range.top - value) / span));
}

/**
 * Which ends of the axis get a word: "Ahead" only when some take was ahead of
 * the band, "Behind" only when one was behind it. A label over an empty
 * stretch of axis names a direction nobody played in.
 */
export function axisLabels(
  values: readonly number[],
  range: TrendRange,
): { ahead: boolean; behind: boolean } {
  return {
    ahead: values.some((value) => value > range.bandTop),
    behind: values.some((value) => value < range.bandBottom),
  };
}
