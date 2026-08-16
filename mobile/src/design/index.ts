export { colors, type ColorToken } from './colors';
export { spacing, type SpacingToken } from './spacing';
export { radii, type RadiusToken } from './radii';
export {
  typography,
  fontFamily,
  fontsToLoad,
  type TypographyToken,
} from './typography';
export { motion, pressedOpacity, disabledOpacity } from './motion';

/**
 * Minimum comfortable touch target, in points. Anything interactive should
 * meet this even when its visible box is smaller — use `hitSlop` to make up
 * the difference rather than inflating the visual element.
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
