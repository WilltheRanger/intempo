/**
 * Props for a heading one level below the screen's title.
 *
 * A bare `accessibilityRole="header"` is a level-1 heading on the web —
 * react-native-web renders it as an `<h1>` — which is right for the title a
 * screen leads with and wrong for the sections under it. Every section label
 * was one, so Profile announced five headings at the same level as its title
 * and a screen reader's heading list had no structure to move through.
 *
 * **Spread, not typed props**, because React Native's types do not declare
 * `aria-level` although react-native-web reads it (it picks `<h2>` from it).
 * The cast is here once rather than at each section. Native ignores the level
 * and still announces a heading, which is all iOS and Android have.
 */
export const SECTION_HEADING = {
  accessibilityRole: 'header',
  'aria-level': 2,
} as { accessibilityRole: 'header' };
