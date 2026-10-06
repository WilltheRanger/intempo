import type { UserVerdict } from '../../data/types';

/** The fields of a stored answer this rule reads. */
export interface StoredAnswer {
  measure_number: number;
  user_verdict: UserVerdict;
  created_at: string;
}

/**
 * The answer a musician last gave to the question this result asks, if any.
 *
 * The question is about a passage — `askedBars` — and an answer is stored as
 * one row per bar in it, all with the same verdict. So any row on one of those
 * bars is an answer to this question, and the newest one is the musician's
 * current view: the server appends rather than replaces, because a changed
 * mind is data too.
 *
 * Rows for other bars are ignored. A question that moved — the passage the
 * verdict names came out differently on a re-analysis — was not answered.
 */
export function latestAnswerFor(
  rows: readonly StoredAnswer[] | undefined,
  askedBars: readonly number[],
): UserVerdict | null {
  if (!rows?.length || askedBars.length === 0) return null;
  const asked = new Set(askedBars);
  let newest: StoredAnswer | null = null;
  for (const row of rows) {
    if (!asked.has(row.measure_number)) continue;
    if (newest === null || Date.parse(row.created_at) > Date.parse(newest.created_at)) {
      newest = row;
    }
  }
  return newest?.user_verdict ?? null;
}
