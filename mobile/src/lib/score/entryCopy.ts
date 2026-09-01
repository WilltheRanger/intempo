/**
 * What the bar picker calls itself, which depends on what it governs.
 *
 * **The label used to say "Listen from bar 9" on both screens**, and there was
 * a comment explaining why: on the Record screen a bare "From bar 1" would
 * read as where the *take* starts, "which it is not, and which would be a
 * promise about the analysis that nothing keeps".
 *
 * It is kept now. The same control sets where the recording begins, the
 * request carries it, and the worker trims the score to match — so on that
 * screen the honest words are the ones the old comment refused to use, and on
 * the score screen, where nothing is being recorded, they would be the lie
 * instead. One picker, two truthful labels, chosen by the caller rather than
 * guessed from context.
 *
 * A module rather than a branch in the `.tsx`, for the usual reason: there is
 * no React Native testing library here (`DECISIONS.md`, 2026-08-24), so a rule
 * inside a component is a rule nothing checks.
 */
export type EntryScope = 'listen' | 'take';

/** The quiet line under the button. */
export function entryLabel(scope: EntryScope, bar: number): string {
  return scope === 'take' ? `Start at bar ${bar}` : `Listen from bar ${bar}`;
}

/** Read out instead of the line, so it says what tapping does. */
export function entryAccessibilityLabel(scope: EntryScope, bar: number): string {
  return scope === 'take'
    ? `Start at bar ${bar}. Change where the take begins.`
    : `Listen from bar ${bar}. Change.`;
}

/** The heading of the sheet the tap opens. */
export function entrySheetTitle(scope: EntryScope): string {
  return scope === 'take' ? 'Start the take at' : 'Listen from';
}
