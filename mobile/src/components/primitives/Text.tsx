import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import {
  colors,
  darkColors,
  typography,
  type ColorToken,
  type TypographyToken,
} from '../../design';

export interface TextProps extends RNTextProps {
  /** Which step of the type scale to use. */
  variant?: TypographyToken;
  /** Which colour token to use. */
  color?: ColorToken;
  /**
   * Which palette to resolve that token in.
   *
   * `auto` follows the appearance. `onDark` pins it to the dark palette, for
   * text on a surface that is dark in **both** appearances — the same prop, the
   * same two values and the same meaning as on `GlassSurface` and `IconButton`,
   * which is the point of it being a prop rather than an inline hex: the type
   * scale keeps its tokens either way.
   */
  tone?: 'auto' | 'onDark';
}

/**
 * Every piece of text in the app goes through here.
 *
 * `style` is for layout only — margins, flex, alignment. Font size, family,
 * and colour come from `variant` and `color`; overriding them inline is how a
 * type scale stops being a type scale.
 */
export function Text({
  variant = 'body',
  color = 'textPrimary',
  tone = 'auto',
  style,
  ...rest
}: TextProps) {
  const palette = tone === 'onDark' ? darkColors : colors;
  return (
    <RNText
      {...rest}
      style={[typography[variant], { color: palette[color] }, style]}
    />
  );
}
