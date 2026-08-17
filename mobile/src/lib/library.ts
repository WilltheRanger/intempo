import type { Piece } from '../data/types';
import { daysSincePracticed } from './format';

/**
 * Grouping the repertoire by how long it has been sitting.
 *
 * By recency rather than by composer, which was the other obvious axis and is
 * wrong for this data: a violinist's library is mostly one piece per composer,
 * so composer headings would produce a heading for nearly every row. Recency
 * groups meaningfully *and* answers the question a library is actually opened
 * to answer — what have I not touched in a month.
 *
 * Pure and separate from the screen so the buckets can be checked without a
 * renderer, and so the heading and the row's own label read off one definition
 * of "this week".
 */

export type RecencyKey = 'week' | 'month' | 'earlier' | 'never';

const GROUP_LABELS: Record<RecencyKey, string> = {
  week: 'This week',
  month: 'Earlier this month',
  earlier: 'Longer ago',
  never: 'Not practiced yet',
};

/** Fixed order, so the groups don't reshuffle as pieces move between them. */
const GROUP_ORDER: RecencyKey[] = ['week', 'month', 'earlier', 'never'];

export interface PieceGroup {
  key: RecencyKey;
  label: string;
  pieces: Piece[];
}

function bucketFor(piece: Piece, now: Date): RecencyKey {
  const days = daysSincePracticed(piece.lastPracticedAt, now);
  if (days === null) {
    return 'never';
  }
  if (days < 7) {
    return 'week';
  }
  return days < 28 ? 'month' : 'earlier';
}

/**
 * The library, in groups. Empty groups are dropped rather than shown empty.
 *
 * Within a group, most recently practiced first — except the pieces that never
 * have been, which have no recency to sort by and go alphabetically instead.
 */
export function groupByRecency(pieces: Piece[], now: Date = new Date()): PieceGroup[] {
  const buckets = new Map<RecencyKey, Piece[]>();
  for (const piece of pieces) {
    const key = bucketFor(piece, now);
    const group = buckets.get(key) ?? [];
    group.push(piece);
    buckets.set(key, group);
  }

  return GROUP_ORDER.flatMap((key) => {
    const group = buckets.get(key);
    if (!group || group.length === 0) {
      return [];
    }
    const sorted = [...group].sort((a, b) =>
      key === 'never'
        ? a.title.localeCompare(b.title)
        : (daysSincePracticed(a.lastPracticedAt, now) ?? 0) -
          (daysSincePracticed(b.lastPracticedAt, now) ?? 0),
    );
    return [{ key, label: GROUP_LABELS[key], pieces: sorted }];
  });
}
