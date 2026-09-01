import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { BORDER_WIDTH, colors, motion, radii } from '../../design';
import type { ThumbnailSource } from '../../data/types';
import { sourceIdentity } from '../../lib/imageSource';

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
 *
 * **And when the image fails to arrive, which is not the same thing.** A
 * signed URL is well-formed whether or not the object behind it is still
 * there, so a photograph deleted on accept went on being signed and handed
 * over, and what a musician saw on a piece they had accepted was a large empty
 * box at whatever height the caller had asked for. The server no longer signs
 * a discarded page (`_with_image_urls`), which is the fix; this is the belt to
 * that pair of braces, because a signed URL can also simply expire, and the
 * failure mode should be the placeholder that already exists rather than a
 * hole the size of a page.
 */
export function ScoreThumbnail({
  source,
  radius = radii.sm,
  style,
}: ScoreThumbnailProps) {
  const [failed, setFailed] = useState(false);

  // A new source is a new chance. Without this, one dead URL would keep the
  // placeholder in place after the piece's page had been replaced.
  //
  // Keyed on the identity **inside** the source rather than on the object: a
  // `{ uri, cacheKey }` is built where the API response is mapped, and a
  // refetch that returns the same URL builds a new object. Depending on the
  // object would clear the failure on every such render, so a genuinely dead
  // URL would retry, fail, and reset in a loop.
  const identity = sourceIdentity(source);
  useEffect(() => setFailed(false), [identity]);

  if (source === null || failed) {
    return <StaffPlaceholder radius={radius} style={style} />;
  }

  return (
    <Image
      source={source}
      onError={() => setFailed(true)}
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
