/**
 * Where the bar sits while a page is being read.
 *
 * **A position, not a prediction.** The bar moves when the worker reports a
 * step it has actually reached and at no other time — nothing here creeps
 * forward on a timer toward a number nobody is measuring, which is what the
 * mocked version of the scan flow used to do while performing no work at all.
 *
 * Lives outside `TranscribingPanel` so the rules below can be tested. They were
 * four lines inside the component, one of them wrong, and there is no way to
 * render a React Native component in this test setup to find that out.
 *
 * `fixtures/stages/parity.json` is the contract with
 * `backend/app/workers/transcription_runner.py`. Both sides are tested against
 * it — the words had drifted twice before anything held them together.
 */

/**
 * How far along each step the worker can report is.
 *
 * The fractions are spaced by how much of the job is left after each step
 * rather than evenly, because the steps are not evenly sized: fetching a file
 * is quick and reading a page of notation is most of the wait.
 *
 * **In the order the worker reaches them, and never decreasing.** Checking the
 * bar counts happens after reading, so it sits above it. It used to sit below —
 * 0.6 against reading's 0.7 — which would have walked the bar backwards even
 * if the key had matched.
 *
 * Keyed on the worker's own words. They are the contract between
 * `transcription_runner.py` and this screen, and the contract had drifted both
 * ways: the worker says "Checking the bar counts" and the map said "Checking
 * the reading", while "Finding the staves" was a key nothing had emitted since
 * the Audiveris engine was removed. `parse_sheet_music` cuts a page into
 * systems now and reports that step, so it is live again.
 */
export const STAGE_PROGRESS: Record<string, number> = {
  'Fetching the page': 0.15,
  'Finding the staves': 0.3,
  'Reading the notation': 0.8,
  'Checking the bar counts': 0.9,
};

/** Before the worker has said anything: accepted, not yet started. */
export const QUEUED_PROGRESS = 0.05;

/**
 * Where reading starts and ends, for a page read one stave at a time.
 *
 * The band begins where "Finding the staves" leaves the bar and ends where
 * "Reading the notation" sits. Ending *at* that position rather than below it
 * is deliberate: a page read stave by stave that then fails and falls back to
 * being read whole reports "Reading the notation" after "Reading stave 7 of 7",
 * and the bar has to hold rather than retreat.
 */
const READING_BAND: readonly [number, number] = [0.3, 0.8];

/**
 * The worker's words for a finished stave — `Reading stave 3 of 7`.
 *
 * There is no static position for these: the count is in the words, because a
 * page has as many staves as it has and the app is not told in advance. This is
 * the one stage with measured progress *inside* it, and it exists because
 * reading a page one stave at a time turned a thirty-second step into minutes.
 */
const STAVE_COUNT = /^Reading stave (\d+) of (\d+)$/;

/**
 * The bar's position for a reported stage, given where it already is.
 *
 * A stage this build does not recognise **holds** the bar. That is what the
 * rule has always said and what the code did not do: an unknown stage fell
 * through to `QUEUED_PROGRESS`, so it did not merely fail to advance the bar,
 * it threw the bar back to 5% in the middle of a read — which reads as the
 * scan having restarted, the exact failure this panel exists to prevent. A
 * server reporting a step this build has never heard of is the ordinary
 * consequence of shipping the two halves separately, so it has to be the
 * harmless case.
 */
export function progressFor(stage: string | null | undefined, held: number): number {
  if (!stage) return QUEUED_PROGRESS;

  const known = STAGE_PROGRESS[stage];
  if (known !== undefined) return known;

  const counted = STAVE_COUNT.exec(stage);
  if (counted) {
    const done = Number(counted[1]);
    const total = Number(counted[2]);
    // A count that cannot be a count holds the bar rather than placing it
    // somewhere arithmetic happens to allow. `0 of 0` would divide by zero and
    // `9 of 7` is a server saying something impossible; neither is worth
    // drawing.
    if (total > 0 && done >= 0 && done <= total) {
      const [start, end] = READING_BAND;
      return start + (end - start) * (done / total);
    }
  }

  return held;
}
