import { Pressable, StyleSheet, View } from 'react-native';

import { type LucideIcon } from '../../components/icons';
import { Text } from '../../components/primitives/Text';
import { ROW_PADDING_VERTICAL } from '../../components/rowMetrics';
import { BORDER_WIDTH, colors, MIN_TOUCH_TARGET, ICON_SIZE, ICON_STROKE_WIDTH, spacing } from '../../design';
import { TrailingChevron } from '../../components/primitives/TrailingChevron';

/**
 * One of the piece's doors (`redesign/PieceDetail.dc.html`): a quiet glyph, a
 * name, one line saying what is behind it, and a chevron — "Digital score",
 * "Original pages", "Rename".
 *
 * The glyph is secondary, not tertiary. It was the redesign's 19pt at a 1.5
 * stroke in the faintest grey, which beside a 15pt label in full ink read as a
 * watermark rather than as part of the row (the owner circled these on
 * 2026-09-23). Every row has its own top hairline.
 */
export function PieceLinkRow({
  icon: Icon,
  label,
  description,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  description?: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description ?? undefined}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Icon size={ICON_SIZE.md} strokeWidth={ICON_STROKE_WIDTH} color={colors.textSecondary} />
      <View style={styles.text}>
        <Text variant="rowLabel">{label}</Text>
        {description ? (
          <Text variant="metadataSmall" color="textTertiary" style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>
      <TrailingChevron />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: ROW_PADDING_VERTICAL,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.55,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  description: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
  },
});
