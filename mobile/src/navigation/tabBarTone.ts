import type { TabParamList } from './types';

/**
 * Which material the floating tab bar wears, per screen.
 *
 * **The glass has no ground of its own.** `GlassSurface` is a translucent
 * capsule and whatever scrolls past decides what it looks like — which is fine
 * on four screens that share the appearance's page colour, and wrong on the one
 * that does not. Today is a photograph: an opaque ink ground with a manuscript
 * on it, in *both* appearances, because that is a property of the screen rather
 * than of the appearance (the same argument `colors.darkBg` is named for).
 *
 * Measured before it was changed, because "it looks off" is not a defect
 * report: over the hero, the light appearance composited the capsule to
 * `#CECAC4` on `#2E2620` — a pale slab laid across the photograph — and the
 * header's "+" came out at **1.36:1**, an ivory glyph on ivory glass. The dark
 * appearance was already right by accident (`#241F1B` on `#2E2620`).
 *
 * **The a11y sweep cannot catch this**, which is why the rule is written down
 * here instead of being left to the audit: `audit-a11y.mjs` only measures
 * elements that have `textContent`, and the worst instance of it was an icon —
 * a stroke, with no text node to visit.
 *
 * **A rule, not a ternary in a component.** There is no React Native testing
 * library here (`DECISIONS.md`, 2026-08-24), so `state.routes[state.index]
 * .name === 'Today'` written inside `BottomTabBar.tsx` is a rule nothing
 * checks — `CLAUDE.md` §3. The next dark-ground screen adds a name to the set
 * below and gets the tab bar with it.
 */

/** The material a control layer is drawn in. */
export type SurfaceTone = 'auto' | 'onDark';

/**
 * Screens whose content is a dark ground in both appearances.
 *
 * Not "screens that look dark in dark mode" — every screen does. These are the
 * ones that do not invert, so the chrome over them cannot follow the
 * appearance either.
 */
const DARK_GROUND: ReadonlySet<string> = new Set<keyof TabParamList>(['Today']);

/**
 * The tone for chrome floating over the named tab, or over nothing.
 *
 * `undefined` — no focused route yet, which the navigator can report for a
 * frame — takes the appearance's glass, the same as any ordinary screen.
 */
export function tabBarToneFor(routeName: string | undefined): SurfaceTone {
  return routeName !== undefined && DARK_GROUND.has(routeName) ? 'onDark' : 'auto';
}
