/**
 * Colour tokens. The only place a hex value may appear in this codebase.
 *
 * The eight base tokens were approved as part of the design brief. The three
 * `*Pressed` / `borderStrong` entries are state variants, not new colours:
 * React Native has no `:hover`, `:focus`, or `:active`, so every interactive
 * state has to be an explicit value rather than a derived one.
 */
export const colors = {
  /**
   * Warm ivory page background.
   *
   * Warmed from #FBFAF7. Pure-white cards then sit slightly lighter than the
   * page, which is the intended relationship. Kept pale enough to stay ivory
   * rather than drifting to cream or parchment.
   */
  bg: '#F7F2E9',
  /** Cards and raised surfaces. */
  surface: '#FFFFFF',

  /** Warm near-black. Headings and body copy. */
  textPrimary: '#14110E',
  /**
   * Warm gray. Composer names, supporting copy.
   * 6.51:1 on `bg`, 7.26:1 on `surface` — clearly below primary, comfortably
   * readable, and clear of WCAG AA at any size.
   */
  textSecondary: '#5C564D',
  /**
   * Metadata, placeholders, disabled text.
   *
   * **4.21:1 on `bg`, 4.69:1 on `surface`.** This comment used to claim
   * "~4.6:1 on `bg`, which clears WCAG AA" — that figure is the one for
   * `surface`, and most of this colour's text sits on `bg`, where it is 0.29
   * short of the 4.5 floor. Measured, not estimated: `audit-a11y.mjs`.
   *
   * Left as it is pending a decision on the palette — `#756E63` would clear
   * 4.5:1 on `bg` and is a 4% darkening, visually all but identical — because
   * the palette is the user's to set. What is not deferred is the comment
   * saying it passes when it does not.
   */
  textTertiary: '#7A7367',

  /** Default 1px border on cards, dividers, inputs. */
  border: '#E6E2DA',
  /** Focused/active border. Stands in for the `:focus` ring RN doesn't have. */
  borderStrong: '#D8D2C6',

  /**
   * Muted antique gold. The only accent. Used sparingly.
   *
   * 3.54:1 on `bg`. That clears WCAG AA for *large* text (3:1) and misses it
   * for the 13px labels it is currently used on — active tab labels, section
   * labels, "Metronome off". `#846A44` would clear 4.5:1, at the cost of a
   * visibly darker gold. A palette decision, so it is recorded rather than
   * taken; `audit-a11y.mjs` holds the line at the current value so it cannot
   * quietly get worse.
   */
  accent: '#9A7B4F',

  /**
   * Primary action surface and its label.
   *
   * These two double as the palette for full-bleed dark surfaces — the camera
   * scanner uses `actionBg` as its ground and `actionText` for chrome, rather
   * than introducing a parallel set of near-blacks.
   */
  actionBg: '#1A1714',
  actionText: '#FBFAF7',
  /** Secondary text and inactive chrome on a dark surface. */
  onDarkMuted: 'rgba(251, 250, 247, 0.55)',

  /** Pressed states. */
  actionBgPressed: '#332E28',
  surfacePressed: '#F5F2EC',

  /**
   * Dimming behind a sheet or modal. Derived from `textPrimary` rather than
   * neutral black so it stays in the warm family. Not a new accent — a sheet
   * needs something behind it, and pure black reads cold against ivory.
   */
  scrim: 'rgba(20, 17, 14, 0.32)',

  // -------------------------------------------------------------------------
  // Verdict colours — the verdict screen and nothing else.
  //
  // Quarantined by the spec, and the restriction is the point: they never
  // appear in chrome, navigation, buttons, tabs, or any surface that isn't
  // reporting how a take went. Reach for `accent` everywhere else.
  //
  // They are also never load-bearing. Every verdict carries its word — "On
  // tempo", "Slight rush", "Rushing" — and the colour only reinforces it,
  // because red-green deficiency maps almost exactly onto this trio.
  //
  // Hues are the spec's, darkened only as far as WCAG AA needed on the ivory
  // ground: the spec's own amber measured 2.14:1 there, which its accessibility
  // section forbids. On and mid now sit at 4.50:1, bad at 4.64:1, and all three
  // stay separable under simulated deuteranopia and protanopia.
  // -------------------------------------------------------------------------
  verdictOn: '#1D7F46',
  verdictMid: '#8F681C',
  verdictBad: '#C53B3B',
} as const;

export type ColorToken = keyof typeof colors;
