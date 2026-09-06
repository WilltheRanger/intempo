import type { LucideIcon } from 'lucide-react-native';
import {
  ActivityIndicator,
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
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { PressableScale } from '../motion/PressableScale';
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
  /**
   * `light` inverts the fill for use on a dark ground — cream button, ink
   * label. Not a second style so much as the same button seen against the
   * opposite surface; both tones come from the `action*` pair, which the
   * palette already describes as doubling for full-bleed dark surfaces.
   */
  tone?: 'ink' | 'light';
  style?: StyleProp<ViewStyle>;
}

/**
 * The main action. Charcoal fill, warm-white label, full width.
 *
 * It darkens and gives very slightly under the finger. The movement is kept
 * smaller than a card's so the label remains visually steady, while the
 * shared motion wrapper turns it off when the device or musician requests
 * reduced motion.
 */
export function PrimaryButton({
  label,
  onPress,
  icon: Icon,
  disabled = false,
  loading = false,
  haptic = true,
  size = 'default',
  tone = 'ink',
  style,
}: PrimaryButtonProps) {
  const inactive = disabled || loading;
  const light = tone === 'light';
  const labelColor = light ? 'actionBg' : 'actionText';

  function handlePress() {
    if (haptic) {
      impact(ImpactFeedbackStyle.Light);
    }
    onPress();
  }

  return (
    <PressableScale
      onPress={handlePress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      activeScale={CONTROL_PRESSED_SCALE}
      style={({ pressed }) => [
        styles.button,
        light && styles.buttonLight,
        size === 'compact' && styles.compact,
        pressed && !inactive && (light ? styles.pressedLight : styles.pressed),
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <View style={styles.above}>
          <ActivityIndicator color={light ? colors.actionBg : colors.actionText} />
        </View>
      ) : (
        <View style={[styles.content, size === 'compact' && styles.contentCompact]}>
          {Icon ? (
            <Icon
              size={size === 'compact' ? ICON_SIZE.sm : ICON_SIZE.md}
              strokeWidth={ICON_STROKE_WIDTH}
              color={light ? colors.actionBg : colors.actionText}
            />
          ) : null}
          <Text variant="button" color={labelColor}>
            {label}
          </Text>
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    height: CONTROL_HEIGHT,
    // A capsule. Large continuous radii are the shape language of the control
    // layer around it; `radii.md` was a rounded rectangle from the previous one.
    borderRadius: radii.pill,
    // **Solid ink, not tinted glass.** Glass was tried here and reverted: a
    // translucent ground picks up whatever scrolls beneath it, so the app's
    // single most important control was never quite the same colour twice.
    // The primary action is the one thing on a screen that should not be
    // negotiable, and the surrounding chrome being glass is what makes a solid
    // button read as the thing sitting on top of it.
    backgroundColor: colors.actionBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonLight: {
    backgroundColor: colors.actionText,
  },
  compact: {
    // Exactly the minimum comfortable target — no smaller.
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
    // Tighter gutters and a smaller glyph pull the width in, so the button
    // sits under the page title in the hierarchy instead of rivalling it.
    paddingHorizontal: spacing.md,
  },
  pressed: {
    backgroundColor: colors.actionBgPressed,
  },
  pressedLight: {
    backgroundColor: colors.surfacePressed,
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
  above: { zIndex: 1 },
  content: {
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  contentCompact: {
    gap: spacing.xs,
  },
});
