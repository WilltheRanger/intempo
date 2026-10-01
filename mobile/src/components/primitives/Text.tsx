import { Children, type ReactNode } from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import {
  colors,
  darkColors,
  fontFamily,
  typography,
  type ColorToken,
  type TypographyToken,
} from '../../design';
import { hasAccidental, splitAccidentals } from '../../lib/accidentals';

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
    >
      {withAccidentals(rest.children)}
    </RNText>
  );
}

/**
 * ♭ ♮ ♯ ♩ in the one font that has them, at the size and colour around them.
 *
 * Every string a screen prints passes through here, which is why this is the
 * place: "Your low B♭s run sharp", a note name under a graph and a piece
 * title someone typed "in B♭" all get the same flat without any of them
 * asking. Text with none of the four is returned as it came.
 */
function withAccidentals(children: ReactNode): ReactNode {
  return Children.map(children, (child) =>
    typeof child === 'string' && hasAccidental(child)
      ? splitAccidentals(child).map((part, index) =>
          part.accidental ? (
            <RNText key={index} style={ACCIDENTAL_STYLE}>
              {part.text}
            </RNText>
          ) : (
            part.text
          ),
        )
      : child,
  );
}

const ACCIDENTAL_STYLE = { fontFamily: fontFamily.accidentals };
