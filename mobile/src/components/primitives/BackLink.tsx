import { Pressable, StyleSheet } from 'react-native';

import { colors, ICON_STROKE_WIDTH, MIN_TOUCH_TARGET, ICON_SIZE } from '../../design';
import { ChevronLeft } from '../icons';
import { Text } from './Text';

/**
 * "‹ Back to the piece" — the redesign's way off a pushed screen.
 *
 * A line of secondary text with a chevron, not a round icon button: it says
 * where Back goes, which a bare chevron over a score does not. The redesign
 * (2026-09-23) uses it on Record, Tempo and Upload a recording.
 *
 * 44pt tall where the prototype drew 40, because `audit-a11y.mjs` holds every
 * control to the 44pt floor. It sits 6pt into the margin so the chevron, not
 * the hit area, lines up with the text column below it.
 */
export function BackLink({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <ChevronLeft
        size={ICON_SIZE.md}
        strokeWidth={ICON_STROKE_WIDTH}
        color={colors.textSecondary}
      />
      <Text variant="metadata" color="textSecondary">
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: MIN_TOUCH_TARGET,
    marginLeft: -6,
    paddingRight: 6,
  },
  // Small target: a pressed opacity, per CLAUDE.md §3 — a control that looks
  // the same during the press reads as dead.
  pressed: {
    opacity: 0.55,
  },
});
