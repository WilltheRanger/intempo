import { Image } from 'expo-image';
import {
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { BORDER_WIDTH, colors, fontFamily, motion, radii } from '../../design';
import { Text } from './Text';

export interface AvatarProps {
  /** Profile photo. Null falls back to the placeholder mark — the usual case. */
  source: string | null;
  size?: number;
  /**
   * The letter to draw when there is no photograph (`redesign/Profile.dc.html`):
   * the account's own initial on a plain disc, which says whose account it is
   * where the gold-and-charcoal mark only says that there is one.
   */
  initial?: string | null;
  /** Screen readers announce this; omit inside an already-labelled control. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The musician, as a photo or as the placeholder mark.
 *
 * Most accounts have no photo — nothing in the schema stores one, and only an
 * OAuth sign-up brings one along — so the placeholder is the state that
 * matters. A photo replaces it outright rather than sitting behind or beneath
 * it: once there's a real face, the mark has nothing left to say.
 */
export function Avatar({
  source,
  size = 42,
  initial = null,
  accessibilityLabel,
  style,
}: AvatarProps) {
  const shape = { width: size, height: size, borderRadius: size / 2 };

  if (source) {
    return (
      <Image
        source={source}
        // ViewStyle and ImageStyle differ only in `overflow`, which callers
        // don't set here — this prop carries layout, as on `ScoreThumbnail`.
        style={[styles.photo, shape, style as StyleProp<ImageStyle>]}
        contentFit="cover"
        contentPosition="center"
        transition={motion.fast}
        accessibilityLabel={accessibilityLabel}
        accessible={Boolean(accessibilityLabel)}
      />
    );
  }

  if (initial) {
    return (
      <View
        style={[styles.initialDisc, shape, style]}
        accessible={Boolean(accessibilityLabel)}
        accessibilityLabel={accessibilityLabel}
      >
        <Text
          color="textSecondary"
          style={[styles.initial, { fontSize: size * 0.37, lineHeight: size * 0.45 }]}
        >
          {initial.slice(0, 1).toUpperCase()}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.mark, shape, style]}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
    >
      {/* The gold half is the container's own fill; this is the charcoal one. */}
      <View style={styles.half} />
      <View style={styles.core} />
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    backgroundColor: colors.surfacePressed,
  },
  /**
   * Charcoal and gold split down the middle around a light core — the app's
   * two brand colours and nothing else, so it reads as InTempo's mark rather
   * than as a missing image.
   *
   * Proportions are fractions of the box, so one component serves the 42pt
   * header avatar and the 76pt one on Profile without a second set of values.
   */
  initialDisc: {
    backgroundColor: colors.surface,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: fontFamily.serifRegular,
  },
  mark: {
    backgroundColor: colors.accent,
    overflow: 'hidden',
  },
  half: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '50%',
    backgroundColor: colors.actionBg,
  },
  core: {
    position: 'absolute',
    left: '25%',
    top: '25%',
    width: '50%',
    height: '50%',
    borderRadius: radii.pill,
    backgroundColor: colors.actionText,
  },
});
