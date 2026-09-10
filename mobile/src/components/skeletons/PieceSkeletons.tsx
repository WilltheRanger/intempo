import { StyleSheet, View } from 'react-native';

import {
  BORDER_WIDTH,
  CONTROL_HEIGHT,
  colors,
  radii,
  spacing,
} from '../../design';
import { FadeIn } from '../motion';
import { Skeleton, SkeletonText } from '../primitives/Skeleton';

/**
 * Placeholders shaped like the components they stand in for.
 *
 * The measurements here are copied from the real components — a 56pt banner on
 * Today's card, a 52×38 thumbnail on a Library row — because a skeleton whose
 * proportions are a guess produces a jump at exactly the moment someone starts
 * reading, which is worse than a spinner.
 *
 * **They cannot match exactly, and pretending otherwise would be the bug.**
 * How many lines a title takes depends on the title: "Sonata No. 1 in G minor,
 * BWV 1001" wraps to two at 26pt and "Méditation from Thaïs" does not. These
 * are built for the common case in classical repertoire — long titles — and
 * measured against it, not asserted to be pixel-exact.
 *
 * When one of those components changes shape, its skeleton has to follow. The
 * constants are named after the component they mirror to make that obvious.
 */

/** A sheet-music banner, on a library placeholder. */
const BANNER_HEIGHT = 56;
/** `PieceRow`'s thumbnail. */
const THUMBNAIL = { width: 52, height: 38 };

/**
 * Stands in for a piece that has not arrived yet, in a list.
 *
 * The label is drawn as a placeholder rather than as the real words: it is
 * "Continue practicing", which is only true once there is something to
 * continue, and asserting it over an empty library would be the screen
 * promising something it has not yet checked.
 */
export function ContinueSkeleton() {
  return (
    <View>
      <Skeleton height={13} width={112} style={styles.label} />

      <View style={styles.card}>
        <Skeleton height={BANNER_HEIGHT} radius={0} />
        <View style={styles.cardBody}>
          {/* Title over two lines, composer, movement. */}
          <Skeleton height={26} width="88%" />
          <Skeleton height={26} width="52%" style={styles.gapXs} />
          <Skeleton height={20} width="42%" style={styles.gapSm} />
          <Skeleton height={16} width="30%" style={styles.gapXs} />

          {/* Working tempo, then when it was last practiced. */}
          <Skeleton height={18} width="26%" style={styles.gapMd} />
          <Skeleton height={16} width="38%" style={styles.gapXs} />

          <Skeleton
            height={CONTROL_HEIGHT}
            radius={radii.md}
            style={styles.gapMd}
          />
        </View>
      </View>
    </View>
  );
}

/** Stands in for one `PieceRow`. */
function PieceRowSkeleton({ last = false }: { last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.ruled]}>
      <Skeleton width={THUMBNAIL.width} height={THUMBNAIL.height} />
      <View style={styles.rowBody}>
        {/* Title, then the composer-and-age line. */}
        <Skeleton height={19} width="72%" />
        <Skeleton height={13} width="52%" style={styles.gapXs} />
      </View>
    </View>
  );
}

export interface PieceListSkeletonProps {
  count?: number;
}

/** A run of rows, each arriving just after the one above it. */
export function PieceListSkeleton({ count = 5 }: PieceListSkeletonProps) {
  return (
    <View>
      {Array.from({ length: count }, (_, index) => (
        <FadeIn key={index} index={index}>
          <PieceRowSkeleton last={index === count - 1} />
        </FadeIn>
      ))}
    </View>
  );
}

export { SkeletonText };

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardBody: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  ruled: {
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  rowBody: {
    flex: 1,
  },
  gapXs: { marginTop: spacing.xs },
  gapSm: { marginTop: spacing.sm },
  gapMd: { marginTop: spacing.md },
});
