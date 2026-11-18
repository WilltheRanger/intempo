/**
 * How far the tab bar's capsule sits in from each side of the window.
 *
 * **The capsule belongs to the column, the way the content does.** On a phone
 * the window is the column, and the capsule floats `inset` in from its edges —
 * 12pt outside the 24pt gutter the text keeps. On a wider window the content
 * stops at its measure (`CONTENT_MAX_WIDTH`) and the capsule did not: on a
 * laptop it ran 1,414pt from edge to edge, its three tabs 470pt apart under a
 * 560pt column of content (2026-11-18). It now sits the same `inset` outside
 * the column as it does outside a phone's.
 *
 * Kept free of React Native so a test can hold it (`CLAUDE.md` §3: a rule in a
 * component is a rule nothing checks).
 */
export function tabBarSide(windowWidth: number, column: number, inset: number): number {
  return Math.max(inset, (windowWidth - column) / 2 + inset);
}
