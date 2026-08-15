/**
 * Colour tokens. The only place a hex value may appear in this codebase.
 *
 * The eight base tokens were approved as part of the design brief. The three
 * `*Pressed` / `borderStrong` entries are state variants, not new colours:
 * React Native has no `:hover`, `:focus`, or `:active`, so every interactive
 * state has to be an explicit value rather than a derived one.
 */
export const colors = {
  /** Warm ivory page background. */
  bg: '#FBFAF7',
  /** Cards and raised surfaces. */
  surface: '#FFFFFF',

  /** Warm near-black. Headings and body copy. */
  textPrimary: '#14110E',
  /** Warm gray. Composer names, supporting copy. */
  textSecondary: '#6E6862',
  /** Metadata, placeholders, disabled text. */
  textTertiary: '#A39C93',

  /** Default 1px border on cards, dividers, inputs. */
  border: '#E6E2DA',
  /** Focused/active border. Stands in for the `:focus` ring RN doesn't have. */
  borderStrong: '#D8D2C6',

  /** Muted antique gold. The only accent. Used sparingly. */
  accent: '#9A7B4F',

  /** Primary action surface and its label. */
  actionBg: '#1A1714',
  actionText: '#FBFAF7',

  /** Pressed states. */
  actionBgPressed: '#332E28',
  surfacePressed: '#F5F2EC',
} as const;

export type ColorToken = keyof typeof colors;
