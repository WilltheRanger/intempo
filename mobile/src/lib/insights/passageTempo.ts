import type { TakeResult, Tolerance } from '../../data/types';
import { barTempo } from '../verdict/barTempo';
import { median, trendRange, type TrendRange } from './sessionTrend';

/**
 * One piece's tempo across its length, for Insights' "Worth a look"
 * (`redesign/Insights.dc.html`).
 *
 * **Tempo, not drift** — see `sessionTrend.ts`. Drift grows along a take held
 * steadily slow, so its last passage was always the "worst" and the sentence
 * under the chart said "You slow down at the end" of a piece played at one
 * speed throughout. Each bar's own tempo against the tempo set for it says
 * where the playing actually changed.
 *
 * **Passages of bars, where the prototype says "lines".** Its chart runs
 * "First line" to "Last line" and its button says "Practice the last line",
 * but a score here carries no line breaks — the reader returns measures, not
 * systems — so a "line" would be a guess about the musician's page. The
 * measures are split into up to eight consecutive passages instead and named
 * by their bars, which is what the Record screen's "Start at" speaks in too.
 *
 * Averaged over the piece's recent takes, bar by bar, rather than read off
 * one: "you speed up towards the end" is a habit, and one take is an event.
 */

export interface Passage {
  /** First and last bar of the passage. */
  from: number;
  to: number;
  /**
   * How far from the tempo set for it, percent, faster-positive: the median
   * of its bars across the takes averaged.
   */
  value: number;
  /** Outside the on-tempo band: a passage the pipeline would call off. */
  off: boolean;
}

export interface PassageTempo {
  passages: Passage[];
  range: TrendRange;
  /** One sentence about the shape. */
  sentence: string;
  /** The passage most worth practising, or null when every one was on the beat. */
  practice: Passage | null;
}

export const MAX_PASSAGES = 8;

/** A passage is at least this many bars, so a short piece is not eight single bars. */
const MIN_BARS_PER_PASSAGE = 2;

/** How many of the piece's newest takes are averaged. */
const TAKES_AVERAGED = 5;

export function passageTempo(
  takes: readonly TakeResult[],
  pieceId: string,
  tolerance: Tolerance | null,
): PassageTempo | null {
  const recent = takes
    .filter((take) => take.pieceId === pieceId && take.failure === null && take.measures.length > 0)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))
    .slice(0, TAKES_AVERAGED);

  const byBar = new Map<number, number[]>();
  for (const take of recent) {
    for (const measure of take.measures) {
      const tempo = barTempo(measure, take.targetBpm, take.tempoBeatUnit, null);
      if (tempo === null || !Number.isFinite(tempo.deviationPct)) continue;
      const list = byBar.get(measure.measure) ?? [];
      list.push(tempo.deviationPct);
      byBar.set(measure.measure, list);
    }
  }
  const bars = [...byBar.keys()].sort((a, b) => a - b);
  const count = Math.min(MAX_PASSAGES, Math.floor(bars.length / MIN_BARS_PER_PASSAGE));
  if (count < 2) {
    return null;
  }

  const range0 = trendRange([], tolerance);
  const passages: Passage[] = [];
  for (let index = 0; index < count; index += 1) {
    const slice = bars.slice(
      Math.round((index * bars.length) / count),
      Math.round(((index + 1) * bars.length) / count),
    );
    const values = slice.flatMap((bar) => byBar.get(bar) ?? []);
    const value = median(values) ?? 0;
    passages.push({
      from: slice[0],
      to: slice[slice.length - 1],
      value,
      off: value > range0.bandTop || value < range0.bandBottom,
    });
  }

  const worst = passages
    .filter((passage) => passage.off)
    .reduce<Passage | null>(
      (held, passage) =>
        held === null || Math.abs(passage.value) >= Math.abs(held.value) ? passage : held,
      null,
    );
  const whole = allTheWay(passages, range0.bandTop - range0.bandBottom);
  // A piece played at one wrong speed throughout has no passage to single out:
  // the button practises the whole of it again.
  const practice = whole === null ? worst : null;

  return {
    passages,
    range: trendRange(
      passages.map((passage) => passage.value),
      tolerance,
    ),
    sentence: whole ?? sentenceFor(passages, practice),
    practice,
  };
}

/**
 * Which piece is worth a look, and its tempo passage by passage.
 *
 * `pieces` comes most-drift-first from the server, and the first one is the
 * natural answer — but only if the recent takes can show *where* in it the
 * trouble is. A piece whose takes have all aged out of the recent list would
 * get a section with no chart and no bars to practise, over a piece just below it
 * that has both. So the first piece that can be drawn wins, and the top piece
 * with no chart is the fallback.
 */
export function worthALook<P extends { pieceId: string; tolerance: Tolerance | null }>(
  pieces: readonly P[],
  takes: readonly TakeResult[],
  fallbackTolerance: Tolerance | null,
): { piece: P; tempo: PassageTempo | null } | null {
  for (const piece of pieces) {
    const tempo = passageTempo(takes, piece.pieceId, piece.tolerance ?? fallbackTolerance);
    if (tempo) {
      return { piece, tempo };
    }
  }
  return pieces[0] ? { piece: pieces[0], tempo: null } : null;
}

/** "Bars 21–24", or "Bar 7" for a passage of one. */
export function barsLabel(passage: Pick<Passage, 'from' | 'to'>): string {
  return passage.from === passage.to ? `Bar ${passage.from}` : `Bars ${passage.from}–${passage.to}`;
}

/**
 * "Slower than your tempo all the way through.", or null: every passage off
 * the same way, and no further apart than the on-tempo band is wide. Naming
 * the last passage of a piece played at one slow speed — which the rules
 * below would, since one of them has to be the furthest — sends a musician to
 * practise bars that are no worse than the rest.
 */
function allTheWay(passages: readonly Passage[], bandWidth: number): string | null {
  const values = passages.map((passage) => passage.value);
  if (!passages.every((passage) => passage.off)) {
    return null;
  }
  const faster = values.every((value) => value > 0);
  const slower = values.every((value) => value < 0);
  if ((!faster && !slower) || Math.max(...values) - Math.min(...values) > bandWidth) {
    return null;
  }
  return faster
    ? 'Faster than your tempo all the way through.'
    : 'Slower than your tempo all the way through.';
}

function sentenceFor(passages: readonly Passage[], practice: Passage | null): string {
  if (practice === null) {
    return 'Steady all the way through.';
  }
  const rush = practice.value > 0;
  const index = passages.indexOf(practice);
  const third = Math.max(1, Math.floor(passages.length / 3));
  const mean = (list: readonly Passage[]) =>
    list.reduce((sum, passage) => sum + passage.value, 0) / list.length;
  const opening = mean(passages.slice(0, third));
  const closing = mean(passages.slice(-third));
  const builds = rush ? closing > opening : closing < opening;

  if (index === passages.length - 1 && builds) {
    return rush ? 'You speed up at the end.' : 'You slow down at the end.';
  }
  if (index === 0) {
    return rush ? 'You rush at the start.' : 'You drag at the start.';
  }
  const where = barsLabel(practice).toLowerCase();
  return rush ? `You rush most in ${where}.` : `You drag most in ${where}.`;
}
