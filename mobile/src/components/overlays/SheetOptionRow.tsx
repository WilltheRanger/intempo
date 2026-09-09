import type { LucideIcon } from '../icons';
import { StyleSheet, View } from 'react-native';

import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  spacing,
} from '../../design';
import { PressableScale } from '../motion/PressableScale';
import { Text } from '../primitives/Text';

export interface SheetOptionRowProps {
  icon: LucideIcon;
  label: string;
  description: string;
  onPress: () => void;
  /** Hairline above the row. Omit on the first row in a group. */
  divided?: boolean;
}

/** One choice inside a sheet: glyph, label, and a line explaining it. */
export function SheetOptionRow({
  icon: Icon,
  label,
  description,
  onPress,
  divided = true,
}: SheetOptionRowProps) {
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.99}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      style={({ pressed }) => [
        styles.row,
        divided && styles.divided,
        pressed && styles.pressed,
      ]}
    >
      <Icon
        size={ICON_SIZE.lg}
        strokeWidth={ICON_STROKE_WIDTH}
        color={colors.textPrimary}
      />

      <View style={styles.text}>
        <Text variant="button">{label}</Text>
        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.description}
        >
          {description}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.lg,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  text: {
    flex: 1,
  },
  description: {
    marginTop: spacing.xs,
  },
});
