import { StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, CONTROL_HEIGHT, colors, radii, spacing } from '../../design';
import { FadeIn } from '../motion';
import { Skeleton, SkeletonText } from '../primitives/Skeleton';

/**
 * Placeholders shaped like the components they stand in for.
 *
 * The measurements here are copied from the real components — a 56pt banner on
 * the featured card, a 56×40 thumbnail on a row — so nothing moves when the
 * content lands. A skeleton whose proportions are a guess produces a jump at
 * exactly the moment someone starts reading, which is worse than a spinner.
 *
 * When one of those components changes shape, its skeleton has to follow. The
 * constants are named after the component they mirror to make that obvious.
 */

/** `FeaturedPieceCard`'s sheet-music banner. */
const BANNER_HEIGHT = 56;
/** `PieceCard`'s thumbnail, dense and standard. */
const THUMBNAIL = { width: 56, height: 40 };
const THUMBNAIL_DENSE = { width: 52, height: 40 };

/** Stands in for `FeaturedPieceCard`. */
export function FeaturedPieceSkeleton() {
  return (
    <View style={styles.featured}>
      <Skeleton height={BANNER_HEIGHT} radius={0} />
      <View style={styles.featuredBody}>
        {/* Title, composer, movement — the card's three lines, in its order. */}
        <Skeleton height={22} width="82%" />
        <Skeleton height={15} width="46%" style={styles.gapSm} />
        <Skeleton height={14} width="34%" style={styles.gapSm} />
        <Skeleton height={3} radius={radii.pill} style={styles.gapLg} />
        <Skeleton height={13} width="52%" style={styles.gapMd} />
        <Skeleton
          height={CONTROL_HEIGHT}
          radius={radii.md}
          style={styles.gapLg}
        />
      </View>
    </View>
  );
}

export interface PieceRowSkeletonProps {
  dense?: boolean;
  /** Whether to leave room for the practice line the real row can show. */
  showPracticeDetail?: boolean;
}

/** Stands in for one `PieceCard`. */
export function PieceRowSkeleton({
  dense = false,
  showPracticeDetail = false,
}: PieceRowSkeletonProps) {
  const thumbnail = dense ? THUMBNAIL_DENSE : THUMBNAIL;
  return (
    <View style={styles.row}>
      <Skeleton width={thumbnail.width} height={thumbnail.height} />
      <View style={styles.rowBody}>
        <Skeleton height={19} width="76%" />
        <Skeleton height={14} width="44%" style={styles.gapSm} />
        {showPracticeDetail ? (
          <Skeleton height={12} width="30%" style={styles.gapSm} />
        ) : null}
      </View>
    </View>
  );
}

export interface PieceListSkeletonProps {
  count?: number;
  dense?: boolean;
  showPracticeDetail?: boolean;
}

/** A run of rows, each arriving just after the one above it. */
export function PieceListSkeleton({
  count = 3,
  dense = false,
  showPracticeDetail = false,
}: PieceListSkeletonProps) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, index) => (
        <FadeIn key={index} index={index}>
          <PieceRowSkeleton dense={dense} showPracticeDetail={showPracticeDetail} />
        </FadeIn>
      ))}
    </View>
  );
}

/** A section label's worth of placeholder, for screens that lead with one. */
export function SectionHeadingSkeleton() {
  return <Skeleton height={13} width={112} style={styles.heading} />;
}

export { SkeletonText };

const styles = StyleSheet.create({
  featured: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  featuredBody: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowBody: {
    flex: 1,
  },
  list: {
    gap: spacing.md,
  },
  heading: {
    marginBottom: spacing.md,
  },
  gapSm: { marginTop: spacing.sm },
  gapMd: { marginTop: spacing.md },
  gapLg: { marginTop: spacing.lg },
});
