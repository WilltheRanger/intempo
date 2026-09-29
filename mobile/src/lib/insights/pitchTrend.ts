import type { TakeResult } from '../../data/types';
import { seriesTrend, type TrendData } from '../verdict/trend';

/**
 * "In tune" on Insights: how far the typical note sat from the player's own
 * tuning, take by take — the owner's request of 2026-09-25, "pitch variation
 * as a graph", across takes as well as within one.
 *
 * One point per take, oldest first, as the tempo line is: students do not
 * practise daily, and a calendar axis draws the gaps as flat stretches nobody
 * played. Lower is more in tune.
 */

export interface PitchPoint {
  recordedAt: string;
  /** The typical note's distance from the take's own tuning, in cents. */
  spreadCents: number;
}

export interface PitchTrend {
  /** Oldest first. */
  points: PitchPoint[];
  /** The newest take's in-tune band, drawn under the line. */
  inTuneCents: number;
  /** Past this the line is red rather than gold. */
  slightCents: number;
  /** What the top of the chart stands for, in cents. */
  top: number;
}

/** Two points make a line. */
const MINIMUM_POINTS = 2;

/** The chart never scales below this, so a steady player's line is not a wall. */
const TOP_FLOOR_CENTS = 30;

/** A change smaller than this between the first takes and the latest is noise. */
const CHANGE_WORTH_SAYING_CENTS = 3;

/**
 * The series, or null with fewer than two takes read for pitch — the caller
 * then says the finding in words alone. `takes` arrive newest first, as
 * `getRecentTakes` returns them.
 */
export function pitchTrendFrom(takes: readonly TakeResult[]): PitchTrend | null {
  const read = takes.filter(
    (t): t is TakeResult & { intonation: NonNullable<TakeResult['intonation']> } =>
      t.failure === null && t.status === 'ok' && t.intonation != null,
  );
  if (read.length < MINIMUM_POINTS) {
    return null;
  }
  const points = [...read]
    .reverse()
    .map((t) => ({ recordedAt: t.recordedAt, spreadCents: t.intonation.spreadCents }));
  const newest = read[0].intonation;
  const highest = Math.max(...points.map((p) => p.spreadCents));
  return {
    points,
    inTuneCents: newest.inTuneCents,
    slightCents: newest.slightCents,
    top: Math.max(TOP_FLOOR_CENTS, newest.slightCents, Math.ceil((highest * 1.2) / 5) * 5),
  };
}

/**
 * The line under "In tune" on Insights, in three words or fewer (the owner,
 * 2026-09-29: "Within 15 cents of your tuning · closer than before" was
 * jargon). Which way it has gone since the earliest take when that moved;
 * otherwise where the latest sits. The graph under it has the figures.
 */
export function pitchTrendLine(takes: readonly TakeResult[]): string | null {
  const read = takes.filter(
    (t) => t.failure === null && t.status === 'ok' && t.intonation != null,
  );
  const newest = read[0]?.intonation;
  if (!newest) {
    return null;
  }
  const oldest = read[read.length - 1]?.intonation;
  if (oldest && read.length >= MINIMUM_POINTS) {
    const change = oldest.spreadCents - newest.spreadCents;
    if (change >= CHANGE_WORTH_SAYING_CENTS) return 'Closer than before';
    if (change <= -CHANGE_WORTH_SAYING_CENTS) return 'Further out than before';
  }
  return newest.spreadCents <= newest.inTuneCents
    ? 'In tune'
    : `About ${Math.round(newest.spreadCents)} cents off`;
}

/**
 * Takes one after another, as the result screen's kind of graph: cents from
 * the player's own tuning, the in-tune band along the floor, gold past it and
 * red past the "slightly off" distance.
 */
export function pitchTrendData(trend: PitchTrend): TrendData | null {
  const { inTuneCents, slightCents } = trend;
  return seriesTrend(
    trend.points.map((point) => point.spreadCents),
    { centre: 0, low: 0, high: inTuneCents, farLow: -slightCents, farHigh: slightCents },
    (cents) => (cents <= inTuneCents ? null : cents <= slightCents ? 'verdictMid' : 'verdictBad'),
    // A little under zero, so a take right on the tuning is not on the edge.
    { min: -trend.top * 0.06, max: trend.top },
  );
}
