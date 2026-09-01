/**
 * The sentences the Insights screen assembles, out of the component.
 *
 * There is no React Native testing library here (`DECISIONS.md`, 2026-08-24),
 * so a rule written inside a `.tsx` is a rule nothing checks. These are three
 * plural rules and one count, which is exactly the kind of thing that reads
 * fine in review and ships "1 sessions".
 */

/** "last 30 days", for the eyebrow. Lower case — it follows "Insights · ". */
export function windowLabel(days: number): string {
  return days === 1 ? 'last day' : `last ${days} days`;
}

/**
 * Why this piece is the one to practise next.
 *
 * One sentence, because it is a row's detail line rather than a paragraph in a
 * box. The old copy ran to three sentences inside a card and said the same
 * thing: this piece has the most to learn from, so play it again.
 */
export function focusReason(sessions: number): string {
  const count = sessions === 1 ? '1 session' : `${sessions} sessions`;
  return `Your clearest timing pattern, across ${count}. Record another take and compare.`;
}
