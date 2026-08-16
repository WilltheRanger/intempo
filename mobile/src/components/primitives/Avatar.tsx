import { Image } from 'expo-image';
import {
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { BORDER_WIDTH, colors, motion, radii, typography } from '../../design';
import { Text } from './Text';

export interface AvatarProps {
  /** Profile photo. Null falls back to a monogram — the usual case. */
  source: string | null;
  /** The monogram is taken from this. */
  email: string;
  size?: number;
  /** Screen readers announce this; omit inside an already-labelled control. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The musician, as a photo or as a letter.
 *
 * Most accounts have no photo — nothing in the schema stores one, and only an
 * OAuth sign-up brings one along — so the fallback is the state that matters.
 * It's a monogram in the serif rather than a silhouette icon: a letter is
 * specific to the person, reads at any size, and keeps the app's typography
 * doing the work instead of adding a piece of stock art.
 */
export function Avatar({
  source,
  email,
  size = 40,
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

  return (
    <View
      style={[styles.monogram, shape, style]}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
    >
      <Text
        variant="pieceTitle"
        color="textSecondary"
        // Scaled off the box so one component covers a 40pt header avatar and
        // a 64pt one on Profile without a second set of type tokens.
        style={{
          fontSize: size * MONOGRAM_RATIO,
          lineHeight: size * MONOGRAM_RATIO * LINE_HEIGHT_RATIO,
        }}
      >
        {monogram(email)}
      </Text>
    </View>
  );
}

/** Cap height that fills the circle without crowding it. */
const MONOGRAM_RATIO = 0.42;
const LINE_HEIGHT_RATIO =
  typography.pieceTitle.lineHeight / typography.pieceTitle.fontSize;

/**
 * First letter of the address. Falls back to a bullet rather than an empty
 * circle, since an address with no letter in it at all is possible.
 */
function monogram(email: string): string {
  const letter = email.match(/[a-z0-9]/i);
  return letter ? letter[0].toUpperCase() : '•';
}

const styles = StyleSheet.create({
  photo: {
    backgroundColor: colors.surfacePressed,
  },
  monogram: {
    backgroundColor: colors.surface,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    // A circle, so the token scale doesn't apply — but named for the reader.
    borderRadius: radii.pill,
  },
});
