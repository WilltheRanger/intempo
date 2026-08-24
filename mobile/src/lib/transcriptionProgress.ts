/**
 * Where the bar sits while a page is being read.
 *
 * **A position, not a prediction.** The bar moves when the worker reports a
 * step it has actually reached and at no other time — nothing here creeps
 * forward on a timer toward a number nobody is measuring, which is what the
 * mocked version of the scan flow used to do while performing no work at all.
 *
 * Lives outside `TranscribingPanel` so the rule below can be tested. It was
 * four lines inside the component, one of them wrong, and there is no way to
 * render a React Native component in this test setup to find that out.
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
 * `backend/app/tests/test_stage_parity.py` holds the two sides together.
 */
export const STAGE_PROGRESS: Record<string, number> = {
  'Fetching the page': 0.15,
  'Finding the staves': 0.3,
  'Reading the notation': 0.7,
  'Checking the bar counts': 0.85,
};

/** Before the worker has said anything: accepted, not yet started. */
export const QUEUED_PROGRESS = 0.05;

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
  return STAGE_PROGRESS[stage] ?? held;
}
