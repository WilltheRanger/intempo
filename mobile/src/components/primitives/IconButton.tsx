import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import {
  colors,
  disabledOpacity,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
} from '../../design';

export interface IconButtonProps {
  icon: LucideIcon;
  /** Required: an icon alone tells a screen reader nothing. */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A bare icon control at the minimum comfortable touch target.
 *
 * For navigation and transport, where a label would crowd the row. Anything
 * that carries weight on its own should be a Primary or Secondary button.
 */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
  style,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon
        size={ICON_SIZE.md}
        strokeWidth={ICON_STROKE_WIDTH}
        color={disabled ? colors.textTertiary : colors.textPrimary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  disabled: {
    opacity: disabledOpacity,
  },
});
