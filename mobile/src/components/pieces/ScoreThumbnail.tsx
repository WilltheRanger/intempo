import { Image } from 'expo-image';
import {
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { BORDER_WIDTH, colors, motion, radii } from '../../design';
import type { ThumbnailSource } from '../../data/types';

export interface ScoreThumbnailProps {
  source: ThumbnailSource | null;
  /** Corner radius token. Cards use `sm`; the featured banner squares off. */
  radius?: number;
  /** Layout only — width, height, aspect ratio. */
  style?: StyleProp<ViewStyle>;
}

/**
 * A crop of the score itself. Sheet music is the app's visual identity, so
 * this appears wherever a piece does.
 *
 * When there is no image — which is every piece coming from the live API
 * today, since score images sit in a private bucket with no read endpoint —
 * it falls back to ruled staff lines rather than a grey box or a music icon.
 */
export function ScoreThumbnail({
  source,
  radius = radii.sm,
  style,
}: ScoreThumbnailProps) {
  if (source === null) {
    return <StaffPlaceholder radius={radius} style={style} />;
  }

  return (
    <Image
      source={source}
      style={[
        styles.image,
        { borderRadius: radius },
        // ViewStyle and ImageStyle differ only in `overflow`, which callers
        // don't set here — this prop carries layout.
        style as StyleProp<ImageStyle>,
      ]}
      contentFit="cover"
      // Pinned explicitly so every row crops from the same place regardless of
      // the source image's aspect ratio. `cover` never distorts the notation.
      contentPosition="center"
      transition={motion.fast}
      accessible={false}
    />
  );
}

const STAFF_LINE_COUNT = 5;

function StaffPlaceholder({
  radius,
  style,
}: {
  radius: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.placeholder, { borderRadius: radius }, style]}>
      {Array.from({ length: STAFF_LINE_COUNT }, (_, index) => (
        <View key={index} style={styles.staffLine} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.surfacePressed,
  },
  placeholder: {
    backgroundColor: colors.surfacePressed,
    justifyContent: 'space-evenly',
    paddingVertical: '22%',
    paddingHorizontal: '12%',
    overflow: 'hidden',
  },
  staffLine: {
    height: BORDER_WIDTH,
    backgroundColor: colors.border,
    width: '100%',
  },
});
