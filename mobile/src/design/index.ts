export { colors, type ColorToken } from './colors';
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
  STAGGER_MS,
  STAGGER_CAP,
  RISE_DISTANCE,
  PRESSED_SCALE,
  CONTROL_PRESSED_SCALE,
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

/** Icon sizes. One family (Lucide), one stroke weight, three sizes. */
export const ICON_SIZE = {
  sm: 16,
  md: 20,
  lg: 24,
} as const;

export const ICON_STROKE_WIDTH = 1.75;
