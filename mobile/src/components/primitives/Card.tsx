import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { BORDER_WIDTH, colors, radii, spacing } from '../../design';

export interface CardProps {
  children: ReactNode;
  /** Set false when the card's content manages its own insets (e.g. a banner image). */
  padded?: boolean;
  /** Larger radius for cards that act as a major surface. */
  emphasis?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one card in the app. Light and editorial: a hairline border and a warm
 * white fill, no shadow.
 *
 * If a screen seems to need a different card, it needs this one with different
 * content — not a second card style.
 */
export function Card({ children, padded = true, emphasis = false, style }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        emphasis && styles.emphasis,
        padded && styles.padded,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  emphasis: {
    borderRadius: radii.lg,
  },
  padded: {
    padding: spacing.lg,
  },
});
