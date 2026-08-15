import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, typography, type ColorToken, type TypographyToken } from '../../design';

export interface TextProps extends RNTextProps {
  /** Which step of the type scale to use. */
  variant?: TypographyToken;
  /** Which colour token to use. */
  color?: ColorToken;
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
  style,
  ...rest
}: TextProps) {
  return (
    <RNText
      {...rest}
      style={[typography[variant], { color: colors[color] }, style]}
    />
  );
}
