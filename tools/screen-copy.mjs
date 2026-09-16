/**
 * Headings two checks both look for, in one place.
 *
 * **The second time this duplication cost a run.** `verdict-states.mjs` exists
 * because `walk-app.mjs` and `audit-a11y.mjs` each carried their own copy of a
 * verdict sentence, the pipeline's wording changed, and the walk went green
 * while the audit failed one push later. The pre-flight screen's heading then
 * did exactly the same thing: it was pinned in three places across the two
 * tools, and renaming it broke both.
 *
 * So headings a check navigates by live here. Not every string on every
 * screen — only the ones a tool uses to decide *which screen it is looking at*,
 * which is the set that fails confusingly when it drifts.
 */

/**
 * The screen shown before a first take.
 *
 * It was "Before your first take" while it held three static tips. It is now
 * what the app can actually tell about *this* take — the metronome bleeding
 * into the recording, a start bar that opens on rests, a last take that came
 * back silent — so it is named for the question it answers rather than for the
 * occasion it used to appear on.
 */
export const PRACTICE_SETUP_HEADING = 'Ready when you are';

/** The control on the record screen that reopens the one above. */
export const PRACTICE_SETUP_REOPEN = 'Before you record';
