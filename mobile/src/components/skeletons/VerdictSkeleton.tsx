import { StyleSheet, View } from 'react-native';

import { spacing } from '../../design';
import { FadeIn } from '../motion';
import { Skeleton } from '../primitives/Skeleton';

/** The one chart's height, as `MeasureBars` draws it. */
const CHART_HEIGHT = 68;
/** The bar card with its question, about as tall as it opens. */
const CARD_HEIGHT = 230;

/**
 * The verdict screen, waiting.
 *
 * This is the screen where a skeleton earns the most: the analysis genuinely
 * takes seconds, and the musician has just stopped playing and is waiting to
 * be told something. A spinner in that moment says only "something is
 * happening"; the shape of the answer says "it's this, nearly ready".
 *
 * **The shape of the screen as it is now** (2026-09-29): the title, one
 * chart, and the bar's card — not the line chart
 * and forty-row list it drew until then, which moved the page under the
 * musician's eyes the moment the answer arrived.
 */
export function VerdictSkeleton() {
  return (
    <View>
      <FadeIn>
        {/* The title, which fits one line now ("Rushed in the middle"), and
            nothing under it but the chart. */}
        <Skeleton height={34} width="86%" style={styles.gapMd} />
      </FadeIn>

      <FadeIn index={1} style={styles.section}>
        <Skeleton height={CHART_HEIGHT} />
      </FadeIn>

      <FadeIn index={2} style={styles.section}>
        <Skeleton height={CARD_HEIGHT} />
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing['2xl'],
  },
  gapMd: { marginTop: spacing.md },
});
