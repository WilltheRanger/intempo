import { useState } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { spacing, typography, type ColorToken, type TypographyToken } from '../../design';
import { charsPerLine, nameLines, splitTitle } from '../../lib/pieceTitle';
import { Text } from '../primitives/Text';

export interface PieceHeadingProps {
  title: string;
  variant: TypographyToken;
  color?: ColorToken;
  /** The name's own style — the hero sets a size of its own here. */
  style?: StyleProp<TextStyle>;
  /** Where the catalogue line goes: its own line (default), or nowhere. */
  catalogue?: 'line' | 'hidden';
  catalogueColor?: ColorToken;
  numberOfLines?: number;
  containerStyle?: StyleProp<ViewStyle>;
  /** Whether the name is the screen's heading to assistive tech. */
  header?: boolean;
}

/**
 * A piece's title as a heading (`lib/pieceTitle.ts`): the name, broken before
 * its key when it needs two lines, and the catalogue number on a small line
 * under it — so "Sonata No. 1 in G minor, BWV 1001" reads "Sonata No. 1 / in
 * G minor" with "BWV 1001" below, and never "in G / minor".
 *
 * **It measures the width it was given**, because how many characters fit is
 * the whole question; until the first layout it assumes the window less the
 * page's margins, which is what every heading here is.
 */
export function PieceHeading({
  title,
  variant,
  color = 'textPrimary',
  style,
  catalogue = 'line',
  catalogueColor = 'textTertiary',
  numberOfLines,
  containerStyle,
  header = false,
}: PieceHeadingProps) {
  const window = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const available = width > 0 ? width : window.width - spacing['2xl'] * 2;
  const fontSize = StyleSheet.flatten(style)?.fontSize ?? typography[variant].fontSize;
  const parts = splitTitle(title);
  const lines = nameLines(parts.name, charsPerLine(available, fontSize));

  function handleLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (current === next ? current : next));
  }

  return (
    <View style={containerStyle} onLayout={handleLayout}>
      <Text
        variant={variant}
        color={color}
        style={style}
        numberOfLines={numberOfLines}
        accessibilityRole={header ? 'header' : undefined}
        accessibilityLabel={parts.name}
      >
        {lines.join('\n')}
      </Text>
      {parts.catalogue && catalogue === 'line' ? (
        <Text variant="metadata" color={catalogueColor} style={styles.catalogue}>
          {parts.catalogue}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  catalogue: {
    marginTop: spacing.xs,
  },
});
