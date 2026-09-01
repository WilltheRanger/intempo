import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { MIN_TOUCH_TARGET, spacing } from '../../design';
import { Text } from './Text';

export interface SectionHeaderProps {
  label: string;
  /** Optional trailing action, e.g. "See all". */
  actionLabel?: string;
  onActionPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * A quiet label above a group of content, optionally with one action.
 *
 * Sentence case — the brief rules out decorative uppercase labels.
 */
export function SectionHeader({
  label,
  actionLabel,
  onActionPress,
  style,
}: SectionHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <Text variant="sectionLabel" color="textSecondary">
        {label}
      </Text>

      {actionLabel && onActionPress ? (
        <Pressable
          onPress={onActionPress}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.target,
            pressed ? styles.pressed : undefined,
          ]}
        >
          <Text variant="sectionAction" color="textPrimary">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}


const styles = StyleSheet.create({
  /**
   * Padded to a real touch target, not `hitSlop`-ed to one.
   *
   * **`hitSlop` does nothing on the web build.** Measured in Chromium: a click
   * 8pt above such a control — well inside a 12pt slop — did not activate it,
   * while a click on the visible 18pt box did. `PlaybackSettings` reached the
   * same conclusion from the other direction: "a hit area nothing can see is a
   * hit area nothing checks."
   */
  target: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
});
