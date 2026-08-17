import { StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { FadeIn } from '../motion';
import { Skeleton } from '../primitives/Skeleton';

/**
 * Insights, waiting.
 *
 * The screen leads with one emphasised card — the tendency across every
 * session — and then a per-piece list. The skeleton keeps that hierarchy,
 * because the shape is the information: one big thing, then a list, is
 * legible before a single word has loaded.
 */
export function InsightsSkeleton() {
  return (
    <View>
      <FadeIn>
        <View style={styles.card}>
          <Skeleton height={13} width="38%" />
          <Skeleton height={30} width="72%" style={styles.gapMd} />
          <Skeleton height={15} width="86%" style={styles.gapMd} />
          <Skeleton height={12} radius={radii.pill} style={styles.gapLg} />
        </View>
      </FadeIn>

      <FadeIn index={1} style={styles.section}>
        <Skeleton height={13} width={72} style={styles.heading} />
        <View style={styles.rows}>
          {Array.from({ length: 4 }, (_, index) => (
            <FadeIn key={index} index={index + 2}>
              <View style={styles.row}>
                <Skeleton height={17} width="64%" />
                <Skeleton height={13} width="38%" style={styles.gapSm} />
                <Skeleton height={12} radius={radii.pill} style={styles.gapMd} />
              </View>
            </FadeIn>
          ))}
        </View>
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  heading: {
    marginBottom: spacing.md,
  },
  rows: {
    gap: spacing.md,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  gapSm: { marginTop: spacing.sm },
  gapMd: { marginTop: spacing.md },
  gapLg: { marginTop: spacing.lg },
});
