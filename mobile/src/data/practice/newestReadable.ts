/**
 * The newest takes that can actually be shown, without reading the library to
 * find them.
 *
 * **The problem this replaces.** `getLatestTake` asked for every finished
 * analysis — the default page is 200 — sorted them, and returned the first
 * whose `result_json` could be read. To render **one** take on Today. Each of
 * those rows carries its per-note analysis, measured at 214 bytes a note, so a
 * library of 200-note takes moved **10 MB** off the database and down the wire
 * for a screen that shows one verdict. `getRecentTakes` had the same shape with
 * a `×3` fudge, which quietly returned fewer takes than asked for when more
 * than two thirds of a page were unreadable.
 *
 * It could not simply ask for one, and the reason was real: a finished analysis
 * whose result cannot be read is not a take anyone can be shown, so the number
 * of rows needed is not known before they are read.
 *
 * **So it pages.** Newest first, smallest useful page, stopping the moment it
 * has enough — which in every ordinary library is one request for a handful of
 * rows. The pathological case is the same work as before and no more: `maxRows`
 * is the ceiling the old code had by accident, kept on purpose.
 *
 * **Paging needs the server's ordering to be real**, and until now that was a
 * docstring nothing checked — which is why the caller sorted the list again on
 * arrival. `test_analyses_api.py` holds it now: newest first, and a walk
 * through pages that neither repeats a row nor skips one.
 *
 * A module with tests rather than a loop inside the data source, for the
 * reason this project keeps relearning: there is no React Native testing
 * library here (`DECISIONS.md`, 2026-08-24), and a rule with no test is a rule
 * that drifts.
 */

/** One readable take: the row it came from and what was read out of it. */
export interface Readable<Row, Result> {
  row: Row;
  result: Result;
}

export interface NewestReadableOptions {
  /**
   * Rows per request.
   *
   * Bigger than `want` on purpose — a request that returns exactly enough rows
   * only works if every one of them is readable, and the whole reason this
   * exists is that some are not.
   */
  pageSize?: number;
  /**
   * The most rows to look at before giving up.
   *
   * **Not a safety net; a promise about cost.** Without it, a library whose
   * every take is unreadable would page to the end on every screen open. 200
   * is what the single call it replaces examined, so a library that used to
   * produce an answer still produces the same one.
   */
  maxRows?: number;
}

/**
 * Walk newest-first pages until `want` rows have been read, or there are no
 * more, or `maxRows` have been looked at.
 *
 * `read` returns null for a row that cannot be shown. `fetchPage` is given an
 * offset and a limit and must return rows newest first — the ordering is the
 * server's, and it is what makes an offset mean anything.
 */
export async function newestReadable<Row, Result>(
  fetchPage: (offset: number, limit: number) => Promise<Row[]>,
  read: (row: Row) => Result | null,
  want: number,
  { pageSize, maxRows = 200 }: NewestReadableOptions = {},
): Promise<Readable<Row, Result>[]> {
  const wanted = Math.max(0, Math.round(want));
  if (wanted === 0) {
    return [];
  }
  const size = Math.max(1, Math.round(pageSize ?? Math.max(5, wanted * 3)));
  const found: Readable<Row, Result>[] = [];
  let seen = 0;

  while (found.length < wanted && seen < maxRows) {
    // Never overshoot the ceiling on the last page: asking for rows this is
    // not allowed to look at would pay for them and discard them, which is the
    // cost this whole module exists to avoid.
    const page = await fetchPage(seen, Math.min(size, maxRows - seen));
    if (page.length === 0) {
      break;
    }
    seen += page.length;
    for (const row of page) {
      const result = read(row);
      if (result !== null && result !== undefined) {
        found.push({ row, result });
        if (found.length === wanted) {
          break;
        }
      }
    }
    // A short page is the end of the list. Asking again would be one more
    // request for a page that is already known to be empty.
    if (page.length < size) {
      break;
    }
  }

  return found;
}
