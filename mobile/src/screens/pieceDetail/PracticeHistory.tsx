import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, View } from 'react-native';

import { SessionTrendChart } from '../../components/charts/SessionTrendChart';
import { Card } from '../../components/primitives/Card';
import { Text } from '../../components/primitives/Text';
import type { PieceHistory } from '../../data/sources/types';
import { spacing } from '../../design';
import { historyLabel, lastTakeCue } from '../../lib/insights/pieceHistory';
import { sessionTrendFrom } from '../../lib/insights/sessionTrend';
import type { RootNavigation } from '../../navigation/types';

export interface PracticeHistoryProps {
  history: PieceHistory;
}

/**
 * What happened last time, and how it has gone.
 *
 * **The screen for one piece knew nothing about that piece's past.** Today
 * answers "how did last time go" across the library and Insights answers "what
 * do I tend to do" across thirty days — and the screen a musician opens
 * *because* they are about to play this piece answered neither about it.
 * `GET /v1/analyses` has taken a `score_id` all along.
 *
 * **Two cards, which is the one place in this app that earns them.** §3 law 3
 * rules out making every section a box, and the frame this comes from is
 * explicit that it is the counter-argument: these are two genuinely separate
 * objects — a finding about one take, and a shape across many — and the second
 * is a chart, which needs a ground to be a chart on. Everything else on this
 * screen stays on the page.
 *
 * **No Record button in the card.** The frame puts one there because it has no
 * footer; this screen does, pinned, where a thumb reaches it (§3 law 7). A
 * second one would be the same action twice (law 10).
 */
export function PracticeHistory({ history }: PracticeHistoryProps) {
  const navigation = useNavigation<RootNavigation>();
  const label = historyLabel(history);
  const cue = lastTakeCue(history.recent);
  // The same series Insights plots, from the same function, so the piece's own
  // chart and the one on the aggregate screen cannot disagree about a session.
  // Null below three points rather than an axis with a dot on it.
  const trend = sessionTrendFrom(history.recent, history.recent[0]?.tolerance ?? null);

  if (!label && !cue) {
    return null;
  }

  return (
    <View style={styles.stack}>
      {cue ? (
        <Card>
          {/*
            Sentence case. `typography.ts` calls out that the brief rules out
            decorative uppercase, and the eyebrow's letterspacing is what makes
            it read as a different register without shouting.
          */}
          <Text variant="eyebrow" color="textTertiary">
            Last time
          </Text>
          {/*
            The pipeline's own sentence about that take, not a paraphrase of
            it. It is the same words the verdict screen shows, which is what
            makes "see that take" a promise rather than a change of subject.
          */}
          <Text variant="body" style={styles.cue}>
            {cue.headline}
          </Text>
          <Pressable
            onPress={() => navigation.navigate('Verdict', { analysisId: cue.takeId })}
            accessibilityRole="button"
            accessibilityLabel="See that take"
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          >
            <Text variant="metadataSmall" color="accentText">
              See that take ›
            </Text>
          </Pressable>
        </Card>
      ) : null}

      {label ? (
        <Card>
          <Text variant="eyebrow" color="textTertiary">
            Practice
          </Text>
          <Text variant="body" style={styles.cue}>
            {label}
          </Text>
          {/*
            Only once there is a shape to draw. `sessionTrendFrom` returns null
            below three sessions, because an axis with one point on it reads as
            "you have no drift" — a claim — where the count above it on its own
            reads as "not enough yet", which is the truth.
          */}
          {trend ? (
            <SessionTrendChart
              trend={trend}
              accessibilityLabel={`How steady your last ${trend.points.length} takes of this piece were`}
              style={styles.chart}
            />
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  cue: {
    marginTop: spacing.xs,
  },
  link: {
    // A 44pt row rather than a line of type, pulled back so the extra height
    // does not open a gap under the sentence it belongs to.
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.xs,
    marginBottom: -spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
  chart: {
    marginTop: spacing.md,
  },
});
