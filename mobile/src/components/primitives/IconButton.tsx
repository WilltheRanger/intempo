import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  colors,
  disabledOpacity,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
} from '../../design';
import { PressableScale } from '../motion/PressableScale';
import { GlassSurface } from './GlassSurface';

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
      {/* Circular neutral glass. An icon alone on the page background gave a
          44pt target no visible edge — it read as a glyph rather than as a
          control, which is what "where is the actual add piece" was about. */}
      <GlassSurface radius={MIN_TOUCH_TARGET / 2} style={styles.fill} />
      <View style={styles.glyph}>
        <Icon
          size={ICON_SIZE.md}
          strokeWidth={ICON_STROKE_WIDTH}
          color={disabled ? colors.textTertiary : colors.textPrimary}
        />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  /*
    **Above the glass.** `GlassSurface` fills the control absolutely, and a
    positioned element paints over its non-positioned siblings whatever the DOM
    order — so without this the material covers the label instead of sitting
    behind it. Measured: the header's "+" rendered pale grey rather than ink.
  */
  glyph: { zIndex: 1 },
  button: {
    overflow: 'hidden',
    borderRadius: radii.pill,
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
    The ground is a translucent layer beneath the glyph now, not a colour on
    this view, so press is carried by compression plus a small lift-off.
  */
  pressed: {
    opacity: 0.86,
  },
  disabled: {
    opacity: disabledOpacity,
  },
});
