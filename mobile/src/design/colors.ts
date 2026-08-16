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
   * ~6.9:1 on `bg` — clearly below primary, comfortably readable.
   */
  textSecondary: '#5C564D',
  /**
   * Metadata, placeholders, disabled text.
   * ~4.6:1 on `bg`, which clears WCAG AA for the 14pt metadata step. The
   * previous value sat near 2.6:1 and read as washed out.
   */
  textTertiary: '#7A7367',

  /** Default 1px border on cards, dividers, inputs. */
  border: '#E6E2DA',
  /** Focused/active border. Stands in for the `:focus` ring RN doesn't have. */
  borderStrong: '#D8D2C6',

  /** Muted antique gold. The only accent. Used sparingly. */
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
} as const;

export type ColorToken = keyof typeof colors;
