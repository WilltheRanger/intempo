import { spacing } from '../design/spacing';

/**
 * What a row in a list looks like, and which of them draw a rule.
 *
 * **Written because the app had two conventions and no way to tell them apart.**
 * Surveyed 2026-09-14: seventeen row implementations, eight ruling their *top*
 * edge behind a `divided` prop the first row turns off, seven ruling their
 * *bottom* edge behind a `last` prop the last row turns off. Both draw n−1
 * rules, so a list of either kind looks correct on its own — they diverge only
 * at a group boundary, which is exactly where nobody looks. Put one of each in
 * a single list and you get a doubled rule between them, or none at all.
 *
 * The convention is **top-ruled**, for three reasons:
 *
 *  - A `SectionHeader` sits directly above the first row almost everywhere in
 *    this app, and a rule between a heading and the thing it heads separates a
 *    label from its own content.
 *  - `AccountRow` already documents converging on this grammar (2026-09-14),
 *    and Profile was rebuilt around it the same week.
 *  - It is the majority: 8 implementations against 7, 13 call sites against 6.
 *
 * **The rhythm is here too**, because the same survey found it disagreeing:
 * vertical padding was 16 in most rows, 12 in `MeasureRow` and `ComposerField`,
 * 8 in four more — so `VerdictScreen` and `PieceScoreScreen` each showed two row
 * rhythms on one screen.
 *
 * ## Why the hairline's colour is not in this file
 *
 * It would have to come from `design/resolved.ts`, which reads
 * `Appearance.getColorScheme()` at import — and importing `react-native` into a
 * test pulls its Flow source, which the test runner cannot parse. So this module
 * imports `design/spacing` and nothing else, and owns the *decision*
 * (`ROW_DIVIDER_EDGE`) while each row binds it to `colors.border` itself. The
 * split is the price of the rule being checkable at all, and checkable is the
 * point: `CLAUDE.md` §3 — there is no React Native testing library here, so a
 * rule written inside a `.tsx` is a rule nothing checks.
 *
 * A row that deviates from any of this is free to — it just has to say why, the
 * way `MeasureRow` and `PageRow` do.
 */

/** Space above and below a row's content. */
export const ROW_PADDING_VERTICAL = spacing.lg;

/**
 * Which edge carries the hairline.
 *
 * A string rather than a style object so this file needs no colour token, and
 * so the decision has one name to grep for. Rows spell it out as
 * `borderTopWidth` / `borderTopColor`; changing the convention means changing
 * this constant, its test, and then every row the test failure points at.
 */
export const ROW_DIVIDER_EDGE = 'top' as const;

/**
 * Whether the row at `index` draws its rule.
 *
 * The first row never does — the section heading or the screen edge above it is
 * already the boundary. Every other row does, which puts exactly one hairline
 * between each neighbouring pair and none at either end of the group.
 *
 * Take the index from the same `map` that renders the row, so a list cannot
 * disagree with itself:
 *
 *     {rows.map((row, index) => (
 *       <LinkRow key={row.id} divided={rowDivided(index)} … />
 *     ))}
 */
export function rowDivided(index: number): boolean {
  return index > 0;
}
