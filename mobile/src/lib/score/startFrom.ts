import type { ScoreJson } from '../../data/types';

/**
 * The piece from one bar on, for a take that did not start at the beginning.
 *
 * **Not the same thing as `startAtMeasure`.** That trims a *schedule*, for
 * playback, and rebases the clock to zero. This trims the *score*, because
 * everything the take depends on has to agree about which bar is which:
 * `longRestCues` measures its beats from the first bar played, so cues
 * computed from bar 1 fire at the wrong moments for a take that began at bar
 * 12, and the count-in would lead into the wrong music.
 *
 * The rule is shared with the backend, which trims again before it builds the
 * expected timeline — a timeline containing bars nobody played is misaligned
 * at every onset. Two implementations of one rule, in two languages, with no
 * way to share the walk: `fixtures/practice/start_at.json` is the contract and
 * `startFrom.parity.test.ts` holds this side to it.
 */
export function startFromMeasure(score: ScoreJson, measureNumber: number): ScoreJson {
  const measures = (score.measures ?? []).filter(
    (measure) => measure.measure_number >= measureNumber,
  );
  // Nothing to trim, or nothing left: either way the score on file is the
  // score that was played.
  if (measures.length === 0 || measures.length === (score.measures ?? []).length) {
    return score;
  }

  return {
    ...score,
    measures,
    // Only the repeats the musician could actually have taken. One that spans
    // the entry bar goes too: starting mid-passage means playing straight on,
    // not jumping back to a sign never passed.
    repeats: (score.repeats ?? []).filter(
      (repeat) => repeat.start_measure >= measureNumber,
    ),
    tempo_changes: carriedTempoChanges(score, measureNumber),
  };
}

/**
 * Changes at or after the entry bar, plus the one still standing at it.
 *
 * **The carried one is the point.** A `rit.` printed at bar 3 is still in force
 * at bar 4, and the analysis refuses to time notes under a written change —
 * so dropping it would report a musician dragging for slowing exactly as the
 * page told them to.
 */
function carriedTempoChanges(
  score: ScoreJson,
  measureNumber: number,
): ScoreJson['tempo_changes'] {
  const changes = score.tempo_changes ?? [];
  const after = changes.filter((change) => change.measure_number >= measureNumber);
  const before = changes.filter((change) => change.measure_number < measureNumber);
  if (before.length === 0) {
    return after;
  }
  // Something printed on the entry bar itself supersedes the carried one.
  if (after.some((change) => change.measure_number === measureNumber)) {
    return after;
  }
  const standing = before.reduce((latest, change) =>
    change.measure_number > latest.measure_number ? change : latest,
  );
  // Moved to the entry bar rather than left where it was printed: a change
  // outside the score cannot be found by a walk over the measures.
  return [{ ...standing, measure_number: measureNumber }, ...after];
}
