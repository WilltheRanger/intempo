import type { Schedule } from './schedule';

/**
 * Which bar is sounding, from the clock.
 *
 * **This existed twice, in two `.tsx` files, byte-identical** — once in
 * `PieceDetailScreen` as `measureAt`, once inside a `useMemo` in
 * `PieceScoreScreen` as `soundingMeasure` — each with its own comment
 * explaining the same reasoning. They had not drifted; the point is that
 * nothing would have noticed if they had, and the symptom would be two screens
 * lighting different bars for the same piece at the same moment.
 *
 * `CLAUDE.md` §3: there is no React Native testing library in this project, so
 * a rule inside a `.tsx` is a rule nothing checks. Neither copy was checked.
 *
 * **The rule: the last note to have started, not the nearest.** A playhead
 * names what you are hearing, and between two notes you are still hearing the
 * first — so the bar stays lit through the note rather than blinking off in
 * the gap `articulation` leaves before the next one. Null before the first
 * note, which is where a lead-in sits.
 *
 * **Still a linear scan, deliberately.** A binary search is the obvious move
 * on a sorted array read once per animation frame, and `CLAUDE.md` §1.3 says
 * not to: speed is the thing to leave alone until something is measurably
 * slow, and nothing here has been measured. Moving a rule and changing it in
 * the same commit is also how a refactor becomes a bug hunt.
 */
export function soundingMeasureAt(
  schedule: Schedule | null | undefined,
  elapsedS: number | null,
): number | null {
  if (!schedule || elapsedS === null) {
    return null;
  }
  let current: number | null = null;
  // **`break` is an optimisation here, not the rule**, and a mutation is how
  // that got written down accurately: swapping it for `continue` changes
  // nothing, because a note that has not started is skipped either way. It is
  // an *equivalent mutant*, and no test can kill it without asserting an
  // implementation detail.
  //
  // What it does is stop the scan early, which is only worth anything because
  // the schedule is in time order. `scheduleScore` builds it that way and
  // `playhead.test.ts` pins that, since this is the caller that would start
  // reading the whole array on every frame if it ever stopped being true.
  for (const note of schedule.notes) {
    if (note.startS > elapsedS) {
      break;
    }
    current = note.measureNumber;
  }
  return current;
}
