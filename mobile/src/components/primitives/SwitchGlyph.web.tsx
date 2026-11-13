import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, motion, spacing } from '../../design';

/** UIKit's switch: 51 by 31, a 27-point thumb two points in from the track. */
const TRACK = { width: 51, height: 31 } as const;
const THUMB = 27;
const INSET = spacing['2xs'];
/** How far the thumb crosses the track. */
const TRAVEL = TRACK.width - INSET * 2 - THUMB;

/**
 * The picture of a switch, drawn to UIKit's proportions, for the web build.
 *
 * **react-native-web's switch is a Material toggle**, 40 by 20 with a thumb
 * that overhangs its track — on an iPhone, the one control in Profile that
 * did not look like the phone it was on (2026-11-13). This is UISwitch's
 * shape in the app's palette: gold when on, the strong border when off, a
 * white thumb that slides across on the app's ease. The row around it is the
 * control and carries its state (`ToggleRow`); this is only its picture.
 */
export function SwitchGlyph({ value, disabled }: { value: boolean; disabled: boolean }) {
  return (
    <View style={[styles.track, value ? styles.on : styles.off, disabled && styles.disabled, MOTION]}>
      <View
        style={[
          styles.thumb,
          { transform: [{ translateX: value ? TRAVEL : 0 }] },
          THUMB_SHADOW,
          MOTION,
        ]}
      />
    </View>
  );
}

/** The thumb's shadow, which is what makes it read as a thing that slides. */
const THUMB_SHADOW = {
  boxShadow: '0 3px 8px rgba(20, 17, 14, 0.15), 0 1px 1px rgba(20, 17, 14, 0.08)',
} as unknown as ViewStyle;

/** Both the track's colour and the thumb's slide, on the app's one ease. */
const MOTION = {
  transitionProperty: 'transform, background-color',
  transitionDuration: `${motion.base}ms`,
  // `EASE_OUT`, as CSS.
  transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as unknown as ViewStyle;

const styles = StyleSheet.create({
  track: {
    width: TRACK.width,
    height: TRACK.height,
    borderRadius: TRACK.height / 2,
    padding: INSET,
  },
  on: {
    backgroundColor: colors.accent,
  },
  off: {
    backgroundColor: colors.borderStrong,
  },
  disabled: {
    opacity: 0.5,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.surface,
  },
});
