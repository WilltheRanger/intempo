import type { LucideIcon } from 'lucide-react-native';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  CONTROL_HEIGHT,
  colors,
  disabledOpacity,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { Text } from './Text';

export interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
  /** Light impact on press. On by default — primary actions are meaningful. */
  haptic?: boolean;
  /**
   * `compact` shrinks to its content and sits at the minimum comfortable
   * touch target, for a primary action that belongs beside a heading rather
   * than spanning the screen. Same fill, label, and radius either way.
   */
  size?: 'default' | 'compact';
  style?: StyleProp<ViewStyle>;
}

/**
 * The main action. Charcoal fill, warm-white label, full width.
 *
 * There is no scale animation on press — the fill darkens instead, which reads
 * as confirmation without the button appearing to move.
 */
export function PrimaryButton({
  label,
  onPress,
  icon: Icon,
  disabled = false,
  loading = false,
  haptic = true,
  size = 'default',
  style,
}: PrimaryButtonProps) {
  const inactive = disabled || loading;

  function handlePress() {
    if (haptic) {
      impact(ImpactFeedbackStyle.Light);
    }
    onPress();
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        size === 'compact' && styles.compact,
        pressed && !inactive && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.actionText} />
      ) : (
        <View style={[styles.content, size === 'compact' && styles.contentCompact]}>
          {Icon ? (
            <Icon
              size={size === 'compact' ? ICON_SIZE.sm : ICON_SIZE.md}
              strokeWidth={ICON_STROKE_WIDTH}
              color={colors.actionText}
            />
          ) : null}
          <Text variant="button" color="actionText">
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: CONTROL_HEIGHT,
    borderRadius: radii.md,
    backgroundColor: colors.actionBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  compact: {
    // Exactly the minimum comfortable target — no smaller.
    height: MIN_TOUCH_TARGET,
    alignSelf: 'flex-start',
    // Tighter gutters and a smaller glyph pull the width in, so the button
    // sits under the page title in the hierarchy instead of rivalling it.
    paddingHorizontal: spacing.md,
  },
  pressed: {
    backgroundColor: colors.actionBgPressed,
  },
  disabled: {
    opacity: disabledOpacity,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  contentCompact: {
    gap: spacing.xs,
  },
});
