import { StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, spacing } from '../../design';
import { FadeIn } from '../motion';
import { SCREEN_GUTTER } from '../primitives/ScreenContainer';
import { Skeleton, SkeletonText } from '../primitives/Skeleton';

/**
 * Placeholders shaped like the components they stand in for.
 *
 * The measurements here are copied from the real components — a 200pt sheet
 * strip on Today, a 52×38 thumbnail on a Library row — because a skeleton
 * whose proportions are a guess produces a jump at exactly the moment someone
 * starts reading, which is worse than a spinner.
 *
 * **They cannot match exactly, and pretending otherwise would be the bug.**
 * How many lines a title takes depends on the title: "Sonata No. 1 in G minor,
 * BWV 1001" wraps to two at 36pt and "Méditation from Thaïs" does not. These
 * are built for the common case in classical repertoire — long titles — and
 * measured against it, not asserted to be pixel-exact.
 *
 * When one of those components changes shape, its skeleton has to follow. The
 * constants are named after the component they mirror to make that obvious.
 */

/** `ContinuePanel`'s full-bleed sheet strip. */
const SHEET_HEIGHT = 200;
/** `PieceRow`'s thumbnail. */
const THUMBNAIL = { width: 52, height: 38 };

/** The 36pt title's line box, and the leading between two of them. */
const TITLE_LINE = 36;
const TITLE_LEADING = 6;

/**
 * Stands in for Today's title block and `ContinuePanel`.
 *
 * The title is drawn here even though the screen renders it above the panel,
 * because it is the piece's title and arrives with the piece — unlike the
 * greeting above it, which is known immediately and is never a placeholder.
 *
 * Two title lines, then composer, then movement: the shape of a piece of
 * classical repertoire. One line would sit the sheet strip 66pt too high and
 * drop it as the content landed.
 */
export function ContinueSkeleton() {
  return (
    <View>
      <Skeleton height={TITLE_LINE} width="92%" />
      <Skeleton height={TITLE_LINE} width="64%" style={styles.titleSecondLine} />
      {/* Composer, then movement. */}
      <Skeleton height={20} width="42%" style={styles.gapXs} />
      <Skeleton height={18} width="26%" style={styles.gapXs} />

      {/*
        `width="auto"` matters: the default is `100%`, which is the parent's
        content box, so the negative margins slid the block left instead of
        widening it and only the left edge bled. Stretching gives it the
        parent's width to extend *from*.
      */}
      <Skeleton
        width="auto"
        height={SHEET_HEIGHT}
        radius={0}
        style={styles.sheet}
      />

      {/* The practice sentence, then the working tempo. */}
      <SkeletonText lines={2} style={styles.reason} />
      <Skeleton height={14} width="38%" style={styles.gapSm} />
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
  sheet: {
    marginTop: spacing['2xl'],
    marginHorizontal: -SCREEN_GUTTER,
    alignSelf: 'stretch',
  },
  reason: {
    marginTop: spacing['2xl'],
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
  titleSecondLine: { marginTop: TITLE_LEADING },
  gapXs: { marginTop: spacing.xs },
  gapSm: { marginTop: spacing.sm },
});
