import type { LucideIcon } from '../icons';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  BORDER_WIDTH,
  CONTROL_HEIGHT,
  CONTROL_PRESSED_SCALE,
  colors,
  disabledOpacity,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  radii,
  spacing,
} from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { PressableScale } from '../motion/PressableScale';
import { Text } from './Text';

export interface SecondaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * On a ground that is dark in both appearances.
   *
   * The same reason `GlassSurface` has a `tone`: this button's label is ink in
   * the light palette, and ink on `darkBg` is unreadable. The material has to
   * be pinned to the dark palette and the label turned over with it, or the
   * two disagree — which is the ivory-on-ivory failure `GlassSurface` records.
   */
  onDark?: boolean;
}

/** The quieter action. Bordered, transparent fill, charcoal label. */
export function SecondaryButton({
  label,
  onPress,
  icon: Icon,
  disabled = false,
  style,
  onDark = false,
}: SecondaryButtonProps) {
  const ink = onDark ? colors.onDark : colors.textPrimary;
  return (
    <PressableScale
      onPress={() => {
        // The same tick the primary button gives, at the same weight. They sit
        // side by side on half the screens in this app, and one answering the
        // finger while the other does not reads as the quiet one being broken
        // rather than as the quiet one being quiet.
        impact(ImpactFeedbackStyle.Light);
        onPress();
      }}
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
      {/*
        **A solid control.** This was a glass capsule; design law 6 now keeps
        the material for the bottom bar alone. What a secondary action needs
        is an edge that says it is pressable and a fill that separates it from
        the ground, and two tokens do that without a material.

        `onDark` still matters: over the Today photograph a white fill is a
        slab, so that case keeps a translucent wash of ink and a brighter edge
        — the same job the glass `tone` was doing, done with colour.
      */}
      <View
        style={[
          styles.fill,
          styles.solid,
          onDark ? styles.solidOnDark : styles.solidOnGround,
        ]}
      />
      <View style={styles.content}>
        {Icon ? (
          <Icon
            size={ICON_SIZE.md}
            strokeWidth={ICON_STROKE_WIDTH}
            color={ink}
          />
        ) : null}
        <Text variant="button" style={{ color: ink }}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  solid: {
    borderRadius: CONTROL_HEIGHT / 2,
    borderWidth: BORDER_WIDTH,
  },
  solidOnGround: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  solidOnDark: {
    // Not `surface`: an ivory slab over the photograph. A wash of light with a
    // soft edge reads as a control without covering the picture — the same two
    // tokens the other `onDark` controls in this app already use.
    backgroundColor: colors.onDarkFill,
    borderColor: colors.onDarkMuted,
  },
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
