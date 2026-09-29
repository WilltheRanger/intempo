import type { PieceInsight, TakeResult } from '../../data/types';
import { readPieceWord } from '../insights/tendency';
import { formatTakeVerdict } from '../tempo';

/**
 * The line under a piece on the Library shelf and in Insights' list: how it
 * last went, in the result screen's own words (the owner, 2026-09-29, "words
 * only" over the "Slight drag" slider bar).
 *
 * **The last take's title where there is one**, shortened the way a label is
 * ("You rushed in the middle" → "Rushed in the middle"); the piece's overall
 * word where only the aggregate is known; nothing where neither is. Not "Not
 * played yet": the shelf is grouped by when, so its heading already says it,
 * and a piece played before the recent takes were fetched would be told it
 * never was.
 */
export function pieceStatus({
  lastTake,
  insight,
}: {
  lastTake?: TakeResult | null;
  insight?: Pick<PieceInsight, 'meanDeviationPct' | 'spreadPct' | 'tolerance' | 'verdict'> | null;
}): string | null {
  if (lastTake && lastTake.failure === null && !lastTake.lowConfidence && lastTake.measures.length > 0) {
    return asLabel(formatTakeVerdict(lastTake.measures, lastTake.direction));
  }
  if (insight) {
    return readPieceWord(insight);
  }
  return null;
}

/** "You rushed in the middle" → "Rushed in the middle"; a title without "You" is kept. */
export function asLabel(title: string): string {
  const rest = title.replace(/^You\s+/, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** The newest take of each piece that a verdict could be read from, newest-first input. */
export function lastTakeByPiece(takes: readonly TakeResult[]): Map<string, TakeResult> {
  const last = new Map<string, TakeResult>();
  for (const take of takes) {
    if (take.failure === null && !last.has(take.pieceId)) {
      last.set(take.pieceId, take);
    }
  }
  return last;
}
