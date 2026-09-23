import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronRight, type LucideIcon } from '../../components/icons';
import { Text } from '../../components/primitives/Text';
import { BORDER_WIDTH, colors, MIN_TOUCH_TARGET } from '../../design';

/**
 * One of the piece's doors (`redesign/PieceDetail.dc.html`): a quiet glyph, a
 * name, one line saying what is behind it, and a chevron — "Digital score",
 * "Original pages", "Rename".
 *
 * The glyph is tertiary and thin: it tells the rows apart at a glance and
 * then gets out of the way of the words. Every row has its own top hairline.
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
      <Icon size={19} strokeWidth={1.5} color={colors.textTertiary} />
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {description ? (
          <Text variant="metadataSmall" color="textTertiary" style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={17} strokeWidth={1.6} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: 13,
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
  label: {
    fontSize: 15,
    lineHeight: 20,
  },
  description: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
  },
});
