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
import { coverFor } from '../../lib/composerPortrait';
import { sourceIdentity } from '../../lib/imageSource';

export interface ScoreThumbnailProps {
  source: ThumbnailSource | null;
  /**
   * Who wrote it, so a piece with no photograph can show its composer.
   *
   * Optional and it stays optional: the scanner's page list and the review
   * screen show pages, not pieces, and have no composer to give.
   */
  composer?: string | null;
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
  composer,
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

  // **The page first, then the composer, then the ruled staff.** A picture of
  // the actual page is what the musician took; a portrait only ever fills a
  // hole. `coverFor` owns that order and is tested — the rule is easy to
  // invert by accident and the result would be a library that shows Beethoven
  // where it has a photograph of the part.
  const cover = coverFor({ thumbnail: failed ? null : source, composer: composer ?? null });

  if (cover.kind === 'staff') {
    return <StaffPlaceholder radius={radius} style={style} />;
  }

  return (
    <Image
      source={cover.source}
      onError={() => setFailed(true)}
      style={[
        styles.image,
        { borderRadius: radius },
        // ViewStyle and ImageStyle differ only in `overflow`, which callers
        // don't set here — this prop carries layout.
        style as StyleProp<ImageStyle>,
      ]}
      contentFit="cover"
      // **Pinned, and a portrait pins somewhere else.** A page crop is pinned
      // to the centre so every row crops from the same place whatever the
      // source's aspect ratio; a portrait is pinned to its subject's face, so
      // the same file works as a square in the Library and as a wide banner on
      // Today. One image, two shapes — see `composerPortrait.ts`.
      contentPosition={
        cover.kind === 'portrait'
          ? { left: `${cover.focus.x}%`, top: `${cover.focus.y}%` }
          : 'center'
      }
      transition={motion.fast}
      accessible={false}
    />
  );
}

const STAFF_LINE_COUNT = 5;

/** How far the ruled lines sit inside the box, as fractions of it. */
const STAFF_INSET_Y = 0.22;
const STAFF_INSET_X = 0.12;

/**
 * Five ruled lines, inset proportionally in whatever box it is given.
 *
 * **The inset is measured, because a percentage cannot say "of myself".** CSS
 * and Yoga both resolve percentage padding against the *parent's width*, so
 * `paddingVertical: '22%'` on a 52x38 thumbnail inside a 350pt row came to 77pt
 * top and bottom: the box grew to 84x154 and held nothing but padding — a large
 * empty rectangle where the piece's cover should be, which is exactly what the
 * owner reported for a piece whose photograph had been deleted.
 *
 * It had never rendered. Every fixture piece carried a photograph, so this
 * branch was unreachable in the only build these screens can be driven in —
 * the same gap `UNREAD_CLEF_SCORE` was added to close, one file over. There is
 * a piece with no photograph in the fixtures now.
 */
function StaffPlaceholder({
  radius,
  style,
}: {
  radius: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  return (
    <View
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((current) =>
          current && current.width === width && current.height === height
            ? current
            : { width, height },
        );
      }}
      style={[
        styles.placeholder,
        { borderRadius: radius },
        style,
        box
          ? {
              paddingVertical: box.height * STAFF_INSET_Y,
              paddingHorizontal: box.width * STAFF_INSET_X,
            }
          : null,
      ]}
    >
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
    // No padding until the box has been measured — see `StaffPlaceholder`. A
    // frame of lines flush to the edges is a frame; a percentage here is a
    // permanently wrong box.
    overflow: 'hidden',
  },
  staffLine: {
    height: BORDER_WIDTH,
    backgroundColor: colors.border,
    width: '100%',
  },
});
