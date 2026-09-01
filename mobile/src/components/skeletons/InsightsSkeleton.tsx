import { StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { FadeIn } from '../motion';
import { Skeleton } from '../primitives/Skeleton';

/**
 * Insights, waiting.
 *
 * The screen leads with the finding — a serif line the width of "You tend to
 * rush" — then its sentence, then the bar, then a list of pieces. The skeleton
 * keeps that hierarchy, because the shape is the information: one big thing,
 * then a list, is legible before a single word has loaded.
 *
 * **It drew a card, and the screen no longer has one.** The placeholder is the
 * promise the loaded screen keeps; a bordered white box that resolves into
 * text on the page ground is a layout jump at exactly the moment a reader is
 * deciding where to look.
 */
export function InsightsSkeleton() {
  return (
    <View>
      <FadeIn>
        <View>
          <Skeleton height={13} width="46%" />
          <Skeleton height={34} width="78%" style={styles.gapMd} />
          <Skeleton height={15} width="86%" style={styles.gapMd} />
          <Skeleton height={12} radius={radii.pill} style={styles.gapLg} />
        </View>
      </FadeIn>

      <FadeIn index={1} style={styles.section}>
        <Skeleton height={13} width={72} style={styles.heading} />
        <View>
          {Array.from({ length: 4 }, (_, index) => (
            <FadeIn key={index} index={index + 2}>
              <View style={[styles.row, index < 3 && styles.ruled]}>
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
  section: {
    marginTop: spacing['2xl'],
  },
  heading: {
    marginBottom: spacing.md,
  },
  row: {
    paddingVertical: spacing.lg,
  },
  ruled: {
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  gapSm: { marginTop: spacing.sm },
  gapMd: { marginTop: spacing.md },
  gapLg: { marginTop: spacing.lg },
});
