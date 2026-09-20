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
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { PressableScale } from '../motion/PressableScale';
import { Text } from '../primitives/Text';

export interface SheetOptionRowProps {
  icon: LucideIcon;
  label: string;
  /**
   * A supporting line under the label, **where the label does not already say
   * it.**
   *
   * Optional, and it was required — which is how "Photograph a page" came to
   * carry "Use the camera on the page in front of you." underneath it. A type
   * that demands a second sentence gets a second sentence, whether or not
   * there is one worth writing, and four rows across this app restated their
   * own labels because of it. `CLAUDE.md` §3 law 10: every element justifies
   * its presence, and a prop that cannot be omitted never has to.
   */
  description?: string;
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
      onPress={() => {
        // The weight every other row in this app answers a press with. A sheet
        // that opens a camera or a file picker has a visible pause before
        // anything happens, and the tick is what says the tap was taken.
        impact(ImpactFeedbackStyle.Light);
        onPress();
      }}
      activeScale={0.99}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Undefined rather than an empty string: a screen reader announces the
      // label alone, instead of pausing for a hint that is not there.
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
        {description ? (
          <Text
            variant="metadataSmall"
            color="textTertiary"
            style={styles.description}
          >
            {description}
          </Text>
        ) : null}
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
