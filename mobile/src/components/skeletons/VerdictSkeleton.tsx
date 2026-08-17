import { StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { FadeIn } from '../motion';
import { Skeleton } from '../primitives/Skeleton';

/** Matches `MeasureRow`'s columns so the list doesn't reflow on arrival. */
const NUMBER_COLUMN = 24;
const VERDICT_COLUMN = 78;
const ROW_GUTTER = spacing.lg;
const CHART_HEIGHT = 96;
const CHART_GUTTER = 54;

/**
 * The verdict screen, waiting.
 *
 * This is the screen where a skeleton earns the most: the analysis genuinely
 * takes seconds, and the musician has just stopped playing and is waiting to
 * be told something. A spinner in that moment says only "something is
 * happening"; the shape of the answer says "it's this, nearly ready".
 *
 * Twelve rows because that's the fixture's length and a typical short study.
 * Being wrong by a row or two costs nothing — being wrong about the *shape*
 * would move the page under someone's eyes.
 */
export function VerdictSkeleton() {
  return (
    <View>
      <FadeIn>
        {/* Eyebrow, then the headline, which wraps to two lines more often
            than not — "You rushed towards the end" doesn't fit one. */}
        <Skeleton height={14} width="44%" />
        <Skeleton height={34} width="88%" style={styles.gapMd} />
        <Skeleton height={34} width="52%" style={styles.gapSm} />
        <Skeleton height={16} width="72%" style={styles.gapLg} />
        <Skeleton height={13} width="58%" style={styles.gapMd} />
      </FadeIn>

      <FadeIn index={1} style={styles.section}>
        <Skeleton height={13} width={96} style={styles.heading} />
        <View style={styles.card}>
          <View style={styles.chartRow}>
            <View style={styles.chartGutter}>
              <Skeleton height={12} width={34} />
              <Skeleton height={12} width={34} />
              <Skeleton height={12} width={34} />
            </View>
            <Skeleton height={CHART_HEIGHT} style={styles.chart} />
          </View>
        </View>
      </FadeIn>

      <FadeIn index={2} style={styles.section}>
        <Skeleton height={13} width={128} style={styles.heading} />
        <View style={styles.rowsCard}>
          {Array.from({ length: 12 }, (_, index) => (
            <View
              key={index}
              style={[styles.row, index > 0 && styles.rowDivided]}
            >
              <Skeleton width={NUMBER_COLUMN} height={14} />
              <Skeleton height={4} radius={radii.pill} style={styles.bar} />
              <Skeleton width={VERDICT_COLUMN} height={13} />
            </View>
          ))}
        </View>
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing['2xl'],
  },
  heading: {
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  chartGutter: {
    width: CHART_GUTTER,
    height: CHART_HEIGHT,
    justifyContent: 'space-between',
  },
  chart: {
    flex: 1,
  },
  rowsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: ROW_GUTTER,
    paddingVertical: spacing.md,
  },
  rowDivided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  bar: {
    flex: 1,
  },
  gapSm: { marginTop: spacing.sm },
  gapMd: { marginTop: spacing.md },
  gapLg: { marginTop: spacing.lg },
});
