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
import { GlassSurface } from './GlassSurface';

export interface IconButtonProps {
  icon: LucideIcon;
  /** Required: an icon alone tells a screen reader nothing. */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /**
   * Which ground this sits on.
   *
   * `auto` follows the appearance, which is right everywhere the control is on
   * the page. `onDark` is for a surface that is dark in *both* appearances — a
   * full-bleed photograph or the camera viewfinder — where `textPrimary` is
   * ink in light mode and the glyph disappears. Same distinction, and the same
   * tokens, as `colors.darkBg`/`onDark`.
   *
   * A prop rather than a second component, because the glass material, the
   * target size and the press behaviour are identical and two copies of those
   * is how the second one stops being updated.
   */
  tone?: 'auto' | 'onDark';
  /**
   * What this control is drawn on.
   *
   * **Glass is chrome over content. Chrome over chrome is plain.** A glass
   * capsule inside a glass sheet has no ground to refract: the two materials
   * stack, the blur compounds, and the result is a pale lozenge on a pale
   * panel. `audit-a11y.mjs` calls that GLASS ON GLASS and it found this one on
   * the record screen's practice sheet the day the sheet arrived.
   *
   * So a control that sits *on* a glass surface asks for `plain`, and gets a
   * bordered fill with a defined ground instead.
   */
  surface?: 'glass' | 'plain';
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
  surface = 'glass',
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
      {surface === 'glass' ? (
        <GlassSurface radius={MIN_TOUCH_TARGET / 2} tone={tone} style={styles.fill} />
      ) : (
        <View style={[styles.fill, styles.plain]} />
      )}
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
  /** The same edge the glass draws, without the material behind it. */
  plain: {
    borderRadius: MIN_TOUCH_TARGET / 2,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.borderStrong,
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
