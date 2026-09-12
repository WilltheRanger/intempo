import { StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, spacing } from '../../design';
import { FadeIn } from '../motion';
import { Skeleton, SkeletonText } from '../primitives/Skeleton';

/**
 * Placeholders shaped like the components they stand in for.
 *
 * The measurements here are copied from the real component — a Library row's
 * 16pt padding, its 19pt title and its 13pt metadata line — because a skeleton
 * whose proportions are a guess produces a jump at exactly the moment someone
 * starts reading, which is worse than a spinner.
 *
 * **They cannot match exactly, and pretending otherwise would be the bug.**
 * How many lines a title takes depends on the title: "Sonata No. 1 in G minor,
 * BWV 1001" wraps to two at 26pt and "Méditation from Thaïs" does not. These
 * are built for the common case in classical repertoire — long titles — and
 * measured against it, not asserted to be pixel-exact.
 *
 * When `PieceRow` changes shape, this has to follow.
 *
 * **`ContinueSkeleton` used to live here and is gone with its screen.** It
 * stood in for Today's carded "Continue practice", which became a photograph
 * with the title written across it — and the photograph needs no placeholder,
 * because it is the same photograph whether or not the piece has arrived.
 */

/**
 * Stands in for one `PieceRow`.
 *
 * **No thumbnail block, because the row no longer has one** — see `PieceRow`
 * for why the page crops went. The padding is that row's 16pt rather than the
 * 12 a 38pt picture used to hold it open at.
 */
function PieceRowSkeleton({ last = false }: { last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.ruled]}>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // `PieceRow`'s, not a guess — see the note at the top of this file.
    paddingVertical: spacing.lg,
  },
  ruled: {
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  rowBody: {
    flex: 1,
  },
  gapXs: { marginTop: spacing.xs },
});
