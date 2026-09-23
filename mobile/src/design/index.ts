export {
  lightColors,
  darkColors,
  paletteFor,
  type ColorToken,
  type ColorScheme,
  type Palette,
} from './colors';
// `colors` is the palette *this launch resolved* — see `resolved.ts` for why
// that decision has to happen at import rather than in an effect.
export { colors, scheme } from './resolved';
export { spacing, type SpacingToken } from './spacing';
export { radii, type RadiusToken } from './radii';
export {
  typography,
  fontFamily,
  fontsToLoad,
  MUSIC_EM_IN_SPACES,
  type TypographyToken,
} from './typography';
export {
  motion,
  pressedOpacity,
  disabledOpacity,
  EASE_OUT,
  SPRING,
  SPRING_CSS,
  STAGGER_MS,
  STAGGER_CAP,
  RISE_DISTANCE,
  PRESSED_SCALE,
  CONTROL_PRESSED_SCALE,
  DIALOG_ENTER_SCALE,
  SKELETON_PULSE,
} from './motion';

/**
 * Minimum comfortable touch target, in points.
 *
 * Anything interactive must meet this, and it must meet it with **layout** —
 * `minHeight` and padding — not with `hitSlop`.
 *
 * **`hitSlop` has no effect under react-native-web**, which is the build these
 * screens are actually driven and shipped in today. Measured in Chromium on
 * the password screen's Show control: a click 8pt above it, well inside its
 * 12pt slop, did not activate it; a click on its visible 18pt box did.
 *
 * This advice used to read "use `hitSlop` to make up the difference rather
 * than inflating the visual element", and eight controls followed it — every
 * link on the sign-in screen among them. Two other files had already
 * discovered the truth and written it down beside their own fix
 * (`PlaybackSettings`, `TodayScreen`) while this line went on recommending the
 * thing that does not work. A hit area nothing can see is a hit area nothing
 * checks; a padded box behaves the same everywhere and can be measured.
 */
export const MIN_TOUCH_TARGET = 44;

/**
 * Height of a full-width control. Comfortably above the minimum target
 * without reading as an oversized button.
 */
export const CONTROL_HEIGHT = 52;

/**
 * Border width for cards, dividers, and controls.
 *
 * A flat 1pt rather than `StyleSheet.hairlineWidth`, which varies with screen
 * density — a border that thins out on a 3x device isn't the same design.
 */
export const BORDER_WIDTH = 1;

/**
 * Icon sizes. One family (Lucide), one stroke weight, and a size for each kind
 * of place an icon stands — set by the type beside it, not chosen per screen.
 *
 * **Why it is a scale of places** (2026-09-23, "icons and bars are not big
 * enough or too big… with most screens"). Measured before this: the header's
 * "+" and search were 20 beside a 34pt title — smaller than the redesign's 22
 * — while the tab bar's were 24 over a 13pt label, and fifteen more places
 * typed a size of their own anywhere from 14 to 38. Each was defensible alone
 * and together they had no proportion. A literal size in a screen is now the
 * exception that needs its reason written beside it (an illustration, a badge).
 */
export const ICON_SIZE = {
  /** Beside 11–13pt type: a pill's chevron, Play inside a pill. */
  sm: 16,
  /** Beside 14–17pt type — a row's icon, a button's — and centred in a 44pt disc. */
  md: 20,
  /**
   * Standing alone: a header's actions beside a 34pt title, and the tab bar.
   * 26 rather than 24 because Lucide draws inside a 24 grid with room to
   * spare — its "+" spans 14 of the 24 — so at 24 the add button's cross was
   * 14pt beside a greeting whose capitals are 23.
   */
  lg: 26,
  /** The one glyph a surface is about: an empty state, the record button. */
  xl: 32,
} as const;

export const ICON_STROKE_WIDTH = 1.75;
