import type { TakeResult } from '../../data/types';
import { FALLBACK_OUTER_PCT, bandFor, verdictColorFor } from '../tempo';
import { barTempo } from '../verdict/barTempo';
import { headlinePassage, type Passage } from '../verdict/passage';
import { seriesTrend, type TrendData } from '../verdict/trend';
import { barsLabel } from './passageTempo';
import { median, takeTempoPct } from './sessionTrend';

/**
 * "Your takes" as a question answered — is it getting better? — rather than a
 * log of sentences (the owner, 2026-09-29, after six rows in a row read "Bars
 * 5–8 at 10x, not 96 BPM").
 *
 * **The passage the takes keep naming**, take by take: when two or more of a
 * piece's verdicts open on the same bars, that is the passage the musician is
 * working on, and its tempo across the takes is the graph. Otherwise each
 * take's tempo as a whole. Percent of each take's own target, faster up, so a
 * take recorded at a different practice tempo is still on the same axis.
 */

export interface TakesTrend {
  /** The bars the graph follows, or null for the takes as a whole. */
  passage: Passage | null;
  data: TrendData;
  /** What the graph is: "Bars 5–8, take by take". */
  title: string;
  /** Which way it has gone, in a sentence, or null when it has not moved. */
  finding: string | null;
  /** The tempo every take aimed for, for the label on its line; null when they differ. */
  target: number | null;
}

/** A change smaller than this, in percent of the tempo, is not a trend. */
const MOVED_PCT = 2;

function readable(take: TakeResult): boolean {
  return take.failure === null && take.status === 'ok' && !take.lowConfidence;
}

/** The bars two or more takes' verdicts open on — the most often named — or null. */
export function repeatedPassage(takes: readonly TakeResult[]): Passage | null {
  const counts = new Map<string, { passage: Passage; count: number }>();
  for (const take of takes.filter(readable)) {
    const passage = headlinePassage(take.headline);
    if (!passage) continue;
    const key = `${passage.from}-${passage.to}`;
    const seen = counts.get(key);
    counts.set(key, { passage, count: (seen?.count ?? 0) + 1 });
  }
  let best: { passage: Passage; count: number } | null = null;
  for (const entry of counts.values()) {
    if (entry.count >= 2 && (!best || entry.count > best.count)) best = entry;
  }
  return best?.passage ?? null;
}

function barsIn(take: TakeResult, passage: Passage) {
  return take.measures
    .filter((m) => m.measure >= passage.from && m.measure <= passage.to)
    .map((m) => barTempo(m, take.targetBpm, take.tempoBeatUnit, null))
    .filter((tempo) => tempo !== null);
}

/** How far a passage sat from its tempo in one take, percent, faster-positive. */
export function passagePct(take: TakeResult, passage: Passage): number | null {
  return median(barsIn(take, passage).map((tempo) => tempo.deviationPct));
}

/**
 * A row's figure: the passage's tempo in that take, or the take's own where
 * there is no passage — in the page's beat unit, whole beats.
 */
export function rowTempo(take: TakeResult, passage: Passage | null): number | null {
  if (!readable(take)) return null;
  const bars = passage
    ? barsIn(take, passage)
    : take.measures
        .map((m) => barTempo(m, take.targetBpm, take.tempoBeatUnit, null))
        .filter((tempo) => tempo !== null);
  const bpm = median(bars.map((tempo) => tempo.bpm));
  return bpm === null ? null : Math.round(bpm);
}

/** The graph for a piece's takes, newest first as they arrive; null with fewer than two to join. */
export function takesTrend(takesNewestFirst: readonly TakeResult[]): TakesTrend | null {
  const takes = [...takesNewestFirst].filter(readable).reverse();
  const passage = repeatedPassage(takes);
  const points = takes
    .map((take) => ({ take, value: passage ? passagePct(take, passage) : takeTempoPct(take) }))
    .filter((point): point is { take: TakeResult; value: number } => point.value !== null);
  if (points.length < 2) return null;

  const tolerance = points[points.length - 1].take.tolerance;
  const inner = { rush: tolerance?.rushing_inner_pct ?? 5, drag: tolerance?.dragging_inner_pct ?? 5 };
  const far = {
    rush: tolerance?.rushing_mid_pct ?? FALLBACK_OUTER_PCT / 2,
    drag: tolerance?.dragging_mid_pct ?? FALLBACK_OUTER_PCT / 2,
  };
  const data = seriesTrend(
    points.map((point) => point.value),
    { centre: 0, low: -inner.drag, high: inner.rush, farLow: -far.drag, farHigh: far.rush },
    (value) => {
      const band = bandFor(value, tolerance);
      return band === 'on' ? null : verdictColorFor(band);
    },
  );
  if (!data) return null;

  const targets = new Set(points.map((point) => Math.round(point.take.targetBpm)));
  const subject = passage ? barsLabel(passage) : 'Your takes';
  const plural = !passage || passage.from !== passage.to;
  return {
    passage,
    data,
    title: passage ? `${barsLabel(passage)}, take by take` : 'Each take',
    finding: findingFor(
      points[0].value,
      points[points.length - 1].value,
      subject,
      plural,
    ),
    target: targets.size === 1 ? [...targets][0] : null,
  };
}

function findingFor(first: number, last: number, subject: string, plural: boolean): string | null {
  const have = plural ? 'have' : 'has';
  const are = plural ? 'are' : 'is';
  if (Math.abs(last) + MOVED_PCT < Math.abs(first)) return `${subject} ${are} getting closer to your tempo.`;
  if (last - first >= MOVED_PCT) return `${subject} ${have} been getting faster.`;
  if (first - last >= MOVED_PCT) return `${subject} ${have} been getting slower.`;
  return null;
}
