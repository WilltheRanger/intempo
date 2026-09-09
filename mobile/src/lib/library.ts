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
    const sorted = [...group].sort((a, b) => {
      if (key === 'never') {
        return a.title.localeCompare(b.title);
      }
      /**
       * **By the instant, though the *heading* above it is still by the day.**
       *
       * `daysSincePracticed` counts whole calendar days, which is exactly
       * right for `bucketFor` — the heading and each row's own label have to
       * agree about which week something falls in, and that is what this
       * module was pulled out of the screen to guarantee. It is wrong for
       * ordering: every piece worked on the same day compares equal, so a
       * morning's three pieces came back in whatever order the server listed
       * them, under a heading claiming to be about recency.
       *
       * The third place this project has ordered by a rounded-off value and
       * inherited row order underneath it — see `today.neglectedFrom` and the
       * Insights headline. Title breaks a genuine tie so the list is stable
       * even for two takes at the same millisecond.
       */
      const at = Date.parse(a.lastPracticedAt ?? '');
      const bt = Date.parse(b.lastPracticedAt ?? '');
      if (at !== bt) {
        // Most recently practiced first.
        return bt - at;
      }
      return a.title.localeCompare(b.title);
    });
    return [{ key, label: GROUP_LABELS[key], pieces: sorted }];
  });
}

/**
 * Searching the repertoire.
 *
 * **This lived in `LibraryScreen.tsx`**, thirty lines above the component,
 * while `groupByRecency` above it lived here with tests — the same screen, the
 * same kind of rule, two different homes. `CLAUDE.md` §3 is explicit about
 * which is right: there is no React Native testing library in this project, so
 * a rule inside a `.tsx` is a rule nothing checks. Nothing checked this one,
 * and it had three defects.
 *
 * **1. Two words found nothing.** The query was matched whole, with
 * `includes`, against title *or* composer separately — so `bach suite`
 * returned **zero** results for a library containing *Suite No. 1 in G major*
 * by *J. S. Bach*, because neither field contains that phrase. Measured
 * against the shipped rule before changing it. That is the most natural thing
 * a musician types into a search box, and it looked like an empty library.
 *
 * **2. Movement was not searched**, though the row shows it. Someone working
 * through the cello suites has six pieces whose movements are *Prélude*,
 * *Allemande*, *Courante* and so on; typing `allemande` found nothing.
 *
 * **3.** The accent-stripping — the one part that was carefully done — was
 * therefore not reaching the field with the most accents in it.
 *
 * Terms are ANDed and fields are ORed: every word must appear somewhere, and
 * it does not matter which field each lands in. That is what makes `bach
 * suite` and `suite bach` the same search, which is what a person expects and
 * what neither of them did.
 */
const SEARCHABLE = (piece: Piece): string[] => [
  piece.title,
  piece.composer ?? '',
  piece.movement ?? '',
];

/**
 * Strips diacritics so "Etudes" finds "Études" and "Saint-Saens" finds
 * "Saint-Saëns" — classical repertoire is full of accents that nobody types.
 */
function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * The pieces a query is looking for, in the order they were given.
 *
 * **The early return is not about correctness**, and a mutation proved it:
 * delete it and every test still passes, because `[].every(...)` is `true`, so
 * a query with no terms already keeps every piece. What it is about is
 * *identity*. The search field starts empty and stays empty for most of the
 * life of the screen, and `filter` allocates a new array every time it runs —
 * which is a new `results`, a new `groupByRecency`, and a re-render of the
 * whole list on every keystroke elsewhere on the screen. Returning the same
 * array is the common case costing nothing.
 */
export function searchLibrary(pieces: Piece[], query: string): Piece[] {
  const terms = normalise(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return pieces;
  }
  return pieces.filter((piece) => {
    const haystack = SEARCHABLE(piece).map(normalise);
    // Every term somewhere, not every term in the same field: a piece is named
    // by its title, its composer and its movement together, and which half of
    // the name a word comes from is not something anybody tracks while typing.
    return terms.every((term) => haystack.some((field) => field.includes(term)));
  });
}
