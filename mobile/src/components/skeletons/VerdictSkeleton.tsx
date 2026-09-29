import { StyleSheet, View } from 'react-native';

import { spacing } from '../../design';
import { FadeIn } from '../motion';
import { Skeleton } from '../primitives/Skeleton';

/** The player: the round button beside its rail. */
const PLAYER_HEIGHT = 48;
/** The trend graph with its axis under it, as `TrendChart` draws it. */
const CHART_HEIGHT = 162;
/** The question under the graph and its four answers. */
const QUESTION_HEIGHT = 110;

/**
 * The verdict screen, waiting.
 *
 * This is the screen where a skeleton earns the most: the analysis genuinely
 * takes seconds, and the musician has just stopped playing and is waiting to
 * be told something. A spinner in that moment says only "something is
 * happening"; the shape of the answer says "it's this, nearly ready".
 *
 * **The shape of the screen as it is now** (2026-09-29): the title, the
 * player, the trend graph and the question under it — not the line chart and
 * forty-row list it drew until then, which moved the page under the
 * musician's eyes the moment the answer arrived.
 */
export function VerdictSkeleton() {
  return (
    <View>
      <FadeIn>
        {/* The title, which fits one line now ("You rushed in the middle"). */}
        <Skeleton height={30} width="86%" style={styles.gapMd} />
      </FadeIn>

      <FadeIn index={1} style={styles.player}>
        <Skeleton height={PLAYER_HEIGHT} />
      </FadeIn>

      <FadeIn index={2} style={styles.section}>
        <Skeleton height={CHART_HEIGHT} />
      </FadeIn>

      <FadeIn index={3} style={styles.section}>
        <Skeleton height={QUESTION_HEIGHT} />
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  player: {
    marginTop: spacing.xl,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  gapMd: { marginTop: spacing.md },
});
