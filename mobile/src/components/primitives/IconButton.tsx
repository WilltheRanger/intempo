import type { LucideIcon } from '../icons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  BORDER_WIDTH,
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
  /**
   * `onDark` for a control over a photograph or another dark ground.
   *
   * It picks the glyph colour and, since design law 6 took the glass away
   * from buttons, the fill and edge too: an ivory disc over the Today
   * photograph is a hole in the picture, where a wash of light still reads
   * as a control.
   */
  tone?: 'auto' | 'onDark';
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
  tone = 'auto',
  style,
}: IconButtonProps) {
  const glyph =
    tone === 'onDark'
      ? disabled
        ? colors.onDarkMuted
        : colors.onDark
      : disabled
        ? colors.textTertiary
        : colors.textPrimary;
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
      {/*
        **The material takes the tone too, not just the glyph.** Setting only
        the glyph was half a fix and it shipped: an `onDark` button in light
        mode drew an ivory "+" on ivory glass at **1.36:1** on the Today hero.
        The sweep cannot see it — it composites glass correctly but only visits
        elements with text in them, and an icon is a stroke.
      */}
      {/*
        **Always plain now.** This chose between a glass capsule and a bordered
        circle, and glass was the default. Design law 6 keeps the material for
        the bottom bar alone, so the choice is gone rather than re-defaulted —
        a prop with one value is a prop that invites the other one back.
      */}
      <View style={[styles.fill, styles.plain, tone === 'onDark' && styles.plainOnDark]} />
      <View style={styles.glyph}>
        <Icon
          size={ICON_SIZE.md}
          strokeWidth={ICON_STROKE_WIDTH}
          color={glyph}
        />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  /** The edge the glass used to draw, without the material behind it. */
  plain: {
    borderRadius: MIN_TOUCH_TARGET / 2,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  plainOnDark: {
    // Over the Today photograph. A white disc would be a hole in the picture;
    // a wash of light with a soft edge is still visibly a control.
    backgroundColor: colors.onDarkFill,
    borderColor: colors.onDarkMuted,
  },
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
