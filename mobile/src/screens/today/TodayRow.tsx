import { ChevronRight } from '../../components/icons';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '../../components/motion';
import { Text } from '../../components/primitives/Text';
import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../design';

export interface TodayRowProps {
  /** What it is — a piece title, or a tendency. Serif, so it leads. */
  title: string;
  /** Why it is here. Never decoration: the reason is the point of the row. */
  detail: string;
  onPress: () => void;
  /**
   * Lines the reason may run to.
   *
   * Three for the last take, whose reason is the pipeline's own sentence and
   * must not be truncated into a different claim; two everywhere else.
   */
  detailLines?: number;
  /** The last row in a group draws no rule. */
  last?: boolean;
}

/**
 * One suggestion under the practice card.
 *
 * **No thumbnail, on purpose.** A sheet crop beside a title is precisely the
 * Library row, and repeating it here would rebuild the resemblance this screen
 * was just pulled apart to remove. The card above already carries the score
 * image; these are reasons, not catalogue entries.
 *
 * Every row states *why* it is on the screen — "rushing across 12 sessions",
 * "not practiced in 4 weeks". A row that only names a piece is a list; a row
 * that gives a reason is a suggestion, and only one of those belongs on Today.
 */
export function TodayRow({
  title,
  detail,
  onPress,
  detailLines = 2,
  last = false,
}: TodayRowProps) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      activeScale={0.99}
      style={({ pressed }) => [
        styles.row,
        !last && styles.ruled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.body}>
        <Text variant="pieceTitle" numberOfLines={2}>
          {title}
        </Text>
        <Text
          variant="metadataSmall"
          color="textSecondary"
          numberOfLines={detailLines}
          style={styles.detail}
        >
          {detail}
        </Text>
      </View>

      <ChevronRight
        size={ICON_SIZE.md}
        strokeWidth={ICON_STROKE_WIDTH}
        color={colors.textTertiary}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // A native list row, not a paragraph with a chevron: 44pt is the minimum
    // a target may be, and a row you tap all day should clear it comfortably.
    minHeight: MIN_TOUCH_TARGET + spacing.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    marginHorizontal: -spacing.sm,
    borderRadius: radii.sm,
  },
  ruled: {
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  body: {
    flex: 1,
  },
  detail: {
    marginTop: 2,
  },
});
