import type { TakeResult } from '../../data/types';

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
      t.failure === null && t.status === 'ok' && t.intonation !== null,
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
    top: Math.max(TOP_FLOOR_CENTS, newest.slightCents, Math.ceil((highest * 1.2) / 5) * 5),
  };
}

/**
 * The sentence under "In tune": where the latest take sat, and whether that is
 * closer than where the run started. Works from one take too, which is what a
 * musician with a single take read for pitch is told.
 */
export function pitchTrendLine(takes: readonly TakeResult[]): string | null {
  const read = takes.filter(
    (t) => t.failure === null && t.status === 'ok' && t.intonation !== null,
  );
  const newest = read[0]?.intonation;
  if (!newest) {
    return null;
  }
  const where =
    newest.spreadCents <= newest.inTuneCents
      ? `Your notes sit within ${Math.round(newest.inTuneCents)} cents of your tuning.`
      : `Your notes sit about ${Math.round(newest.spreadCents)} cents from your tuning.`;
  const oldest = read[read.length - 1]?.intonation;
  if (!oldest || read.length < MINIMUM_POINTS) {
    return where;
  }
  const change = oldest.spreadCents - newest.spreadCents;
  if (change >= CHANGE_WORTH_SAYING_CENTS) {
    return `${where} Closer than your earliest take.`;
  }
  if (change <= -CHANGE_WORTH_SAYING_CENTS) {
    return `${where} Further out than your earliest take.`;
  }
  return where;
}

/** Where a point sits down the chart: 0 at the top, 1 at the bottom (in tune). */
export function pitchY(cents: number, trend: PitchTrend): number {
  return 1 - Math.max(0, Math.min(1, cents / trend.top));
}
