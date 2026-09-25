import type { TakeResult, Tolerance } from '../../data/types';
import { FALLBACK_INNER_PCT, sharedFullScaleFor } from '../tempo';
import { barTempo } from '../verdict/barTempo';

/**
 * Recent sessions, as a series a chart can draw.
 *
 * **Insights had one number and one bar**: the thirty-day mean deviation,
 * drawn as a single fill growing from a centre line. That answers "what do you
 * tend to do" and nothing else — it cannot show that the last four sessions
 * have been steadily improving, or that one of them was an outlier, because a
 * mean has no shape. This turns the same window into the shape.
 *
 * **In tempo, not drift** (the owner, 2026-09-25, "fix the visual hierarchy").
 * Each point used to be the mean of the take's rolling drift — how far its
 * notes had wandered from a click started with the first one. A take held
 * steadily slow grows a beat late every few bars, so every take the owner
 * played sat pinned to the chart's floor under a slab of tint, and the chart
 * said nothing the title had not. The verdict's charts moved to each bar's
 * own tempo for the same reason (#83–#86); this follows them, so a point here
 * and that take's "Across the take" are one measurement.
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
   * How far from the tempo the musician set, percent of it, **faster-positive**:
   * the median of the take's timed bars (`takeTempoPct`).
   */
  value: number;
}

/**
 * The vertical span a take chart draws, in percent of the set tempo, faster-
 * positive.
 *
 * **Fitted to the takes, not centred on the target** (`redesign/Insights.dc.html`).
 * A musician who plays fast has every point above the line, and a symmetric
 * axis spent half the chart on "slower" with nothing in it.
 */
export interface TrendRange {
  /** The value at the top edge and at the bottom edge. */
  top: number;
  bottom: number;
  /**
   * The on-tempo band either side of the target: the take's own inner
   * thresholds — the same cut `barTempo` colours a bar by — so a point inside
   * the band is on tempo in the verdict's words too.
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

/** The middle value, or null for none. Robust to one bar read wildly. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * How far a take's bars sat from the tempo set for each, percent, faster-
 * positive — or null for a take with no bar to time (an older result, or one
 * the page kept entirely under a `rit.`).
 *
 * Each bar exactly as its verdict reads it (`barTempo`): its own target where
 * the page moved it, nothing for a bar the page said not to judge. The median,
 * so one bar of two notes read at twice the speed does not move the take.
 */
export function takeTempoPct(take: TakeResult): number | null {
  const bars = take.measures
    .map((measure) => barTempo(measure, take.targetBpm, take.tempoBeatUnit, null)?.deviationPct)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return median(bars);
}

/**
 * Build the series, or null when there is not enough to draw honestly.
 *
 * Null rather than an empty chart: an axis with nothing on it reads as "you
 * were on tempo", which is a claim, where the caller's empty state reads as
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
    .filter((take) => take.failure === null)
    .map((take) => ({ id: take.id, at: take.recordedAt, value: takeTempoPct(take) }))
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
 * The shortest span, in band-widths: the band is at most two fifths of the
 * plot. Fitted tightly to takes that were all on tempo, the band *was* the
 * plot — the owner's "beige block" again, one change after the drift one.
 */
const MIN_SPAN_IN_BANDS = 2.5;

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
  let high = Math.min(limit, Math.max(bandTop * BAND_MARGIN, ...values));
  let low = Math.max(-limit, Math.min(bandBottom * BAND_MARGIN, ...values));
  // Too short to show the band as a band: lengthen it toward the side the
  // takes lean, in proportion — all of it once they lean past the band, half
  // each way when they sit on the target — so the room goes where the line is
  // rather than into an empty strip under it.
  const short = (bandTop - bandBottom) * MIN_SPAN_IN_BANDS - (high - low);
  if (short > 0) {
    const lean = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const reach = lean >= 0 ? bandTop : -bandBottom;
    const upward = 0.5 + 0.5 * Math.max(-1, Math.min(1, reach > 0 ? lean / reach : 0));
    high += short * upward;
    low -= short * (1 - upward);
  }
  const room = (high - low) * HEADROOM;
  return { top: high + room, bottom: low - room, bandTop, bandBottom };
}

/**
 * Where a value sits vertically, as 0 (top) to 1 (bottom).
 *
 * **Faster goes up**, which means negating: SVG's y grows downward and faster
 * is the top of every other tempo drawing in this app.
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
 * Which ends of the axis get a word: "Faster" only when something was faster
 * than the band, "Slower" only when something was slower. A label over an
 * empty stretch of axis names a direction nobody played in.
 */
export function axisLabels(
  values: readonly number[],
  range: TrendRange,
): { faster: boolean; slower: boolean } {
  return {
    faster: values.some((value) => value > range.bandTop),
    slower: values.some((value) => value < range.bandBottom),
  };
}
