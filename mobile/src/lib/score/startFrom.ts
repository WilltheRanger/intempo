import type { ScoreJson, ScoreMeasure } from '../../data/types';

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
    measures: [entryBar(score, measures[0]), ...measures.slice(1)],
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
 * Changes at or after the entry bar, and every one before it, moved there.
 *
 * **What is in force at the entry bar is the point.** A `rit.` printed at bar
 * 3 is still in force at bar 4, and the analysis refuses to time notes under a
 * written change — so dropping it would report a musician dragging for slowing
 * exactly as the page told them to. A "meno mosso" at bar 10 sets the tempo bar
 * 20 is judged against.
 *
 * **All of them, in the order printed.** This carried the last one alone,
 * which was enough while a marking only said "not steady here". A tempo change
 * remembers what it changed from — "a tempo" after a `rit.` inside a meno
 * mosso returns to the meno mosso — so the entry bar is reached through the
 * same markings the page has, and a `rit.` already ended ends again there. The
 * same rule as `backend/app/services/start_at.py`, held to it by
 * `fixtures/practice/start_at.json`.
 */
function carriedTempoChanges(
  score: ScoreJson,
  measureNumber: number,
): ScoreJson['tempo_changes'] {
  const changes = score.tempo_changes ?? [];
  const after = changes.filter((change) => change.measure_number >= measureNumber);
  const before = changes
    .filter((change) => change.measure_number < measureNumber)
    .sort((a, b) => a.measure_number - b.measure_number);
  // Moved to the entry bar rather than left where it was printed: a change
  // outside the score cannot be found by a walk over the measures.
  return [...before.map((change) => ({ ...change, measure_number: measureNumber })), ...after];
}

/** The three facts a bar can print that hold until the next bar prints one. */
const STANDING_FIELDS = ['time_signature', 'clef', 'key_signature'] as const;

/**
 * The entry bar, carrying whatever metre, clef and key were in force at it.
 *
 * The same rule as the tempo change, one level down. A metre printed at bar 5
 * rides on bar 5 and nowhere else, so a take entering at bar 8 lost it — the
 * trimmed score's header still said 4/4 and nothing in it said otherwise, and
 * `longRestCues`, which counts in the metre in force, counted the wrong beats.
 * The clef and the key are the same shape and were lost the same way.
 *
 * Stamped only where the entry bar prints nothing of its own.
 */
function entryBar(score: ScoreJson, entry: ScoreMeasure): ScoreMeasure {
  const before = (score.measures ?? []).filter(
    (measure) => measure.measure_number < entry.measure_number,
  );
  const update: Partial<ScoreMeasure> = {};
  for (const field of STANDING_FIELDS) {
    if (entry[field] != null) {
      continue;
    }
    const standing = [...before].reverse().find((measure) => measure[field] != null);
    if (standing) {
      // The three fields share a value type only in the loosest sense, and a
      // typed assignment per field is what keeps the loop from lying about it.
      (update as Record<string, unknown>)[field] = standing[field];
    }
  }
  return Object.keys(update).length > 0 ? { ...entry, ...update } : entry;
}
