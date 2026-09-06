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
import { GlassSurface } from './GlassSurface';
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
        size === 'compact' && styles.compact,
        pressed && !inactive && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {/*
        **The primary action is tinted glass, not a flat fill.** It belongs to
        the same material as the navigation floating above the content, which is
        what makes the control layer read as one layer rather than as a bar plus
        some buttons. Tint is spent here and on selected states and nowhere
        else — it is the thing that says "this is the one to press".

        `light` keeps a plain surface: it is used where the button already sits
        on a dark full-bleed ground (the scanner), and glass over glass is the
        mistake this material makes easiest.
      */}
      {light ? (
        <View style={[styles.fill, styles.lightFill]} pointerEvents="none" />
      ) : (
        <GlassSurface
          radius={size === 'compact' ? MIN_TOUCH_TARGET / 2 : CONTROL_HEIGHT / 2}
          tone="prominent"
          style={styles.fill}
        />
      )}
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
    // A capsule. Large continuous radii are the shape language of this
    // material; `radii.md` was a rounded rectangle from the previous one.
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  lightFill: {
    backgroundColor: colors.actionText,
    borderRadius: radii.pill,
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
  /*
    Press is carried by `PressableScale`'s compression and by this small
    lift-off in opacity. A background swap is not available any more — the
    ground is a translucent layer under the label, not a colour on this view —
    and compression is the more physical of the two signals regardless.
  */
  pressed: {
    opacity: 0.86,
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
