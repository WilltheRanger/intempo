import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import {
  colors,
  disabledOpacity,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
} from '../../design';
import { PressableScale } from '../motion/PressableScale';

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
 *
 * It gives slightly under the finger as well as changing fill. These controls
 * are used for back, close, and playback actions, so visual acknowledgement
 * belongs on press-in rather than after navigation has already started.
 */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
  style,
}: IconButtonProps) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      activeScale={0.92}
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
    </PressableScale>
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
