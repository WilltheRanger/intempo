import type { LucideIcon } from 'lucide-react-native';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  CONTROL_HEIGHT,
  CONTROL_PRESSED_SCALE,
  colors,
  disabledOpacity,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  radii,
  spacing,
} from '../../design';
import { PressableScale } from '../motion/PressableScale';
import { GlassSurface } from './GlassSurface';
import { Text } from './Text';

export interface SecondaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** The quieter action. Bordered, transparent fill, charcoal label. */
export function SecondaryButton({
  label,
  onPress,
  icon: Icon,
  disabled = false,
  style,
}: SecondaryButtonProps) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      activeScale={CONTROL_PRESSED_SCALE}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {/* Neutral glass: colourless, so whatever it floats over decides how it
          looks. Tint is reserved for the primary action beside it. */}
      <GlassSurface radius={CONTROL_HEIGHT / 2} style={styles.fill} />
      <View style={styles.content}>
        {Icon ? (
          <Icon
            size={ICON_SIZE.md}
            strokeWidth={ICON_STROKE_WIDTH}
            color={colors.textPrimary}
          />
        ) : null}
        <Text variant="button">{label}</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  button: {
    overflow: 'hidden',
    height: CONTROL_HEIGHT,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
    borderColor: colors.borderStrong,
  },
  disabled: {
    opacity: disabledOpacity,
  },
  /*
    **Above the glass.** `GlassSurface` fills the control absolutely, and a
    positioned element paints over its non-positioned siblings whatever the DOM
    order — so without this the material covers the label instead of sitting
    behind it. Measured: the header's "+" rendered pale grey rather than ink.
  */
  content: {
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
