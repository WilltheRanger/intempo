import { ChartLine } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import {
  Card,
  EmptyState,
  PageHeader,
  ScreenContainer,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { useInsights } from '../../data/hooks/useInsights';
import { describeLoadError } from '../../data/api/describeError';
import { spacing } from '../../design';
import { formatTendency, formatTendencyDetail } from '../../lib/tempo';
import { FadeIn } from '../../components/motion';
import { InsightsSkeleton } from '../../components/skeletons';
import { DeviationBar } from './DeviationBar';
import { PieceInsightRow } from './PieceInsightRow';

/**
 * Practice history in aggregate.
 *
 * The screen answers one question — do you rush or drag, and on which pieces —
 * because that is the question the analysis pipeline is built to answer. It
 * reports in words and bars rather than figures: the spec keeps BPM offsets,
 * percentages, and millisecond deviations out of production copy, on the
 * grounds that a number is something a musician has to translate before it
 * means anything. Session counts stay, since a count of takes isn't a timing
 * measurement.
 *
 * This is live. `apiInsightsSource.getInsights` reads finished analyses from
 * `/v1/analyses`, joins them to `/v1/scores` for titles, and aggregates over
 * the last 30 days in the client — the endpoint returns takes rather than
 * summaries, deliberately, since one list serves several screens.
 *
 * Null means no *usable* takes, not no takes: an analysis with no
 * `per_measure` rows carries no timing to aggregate and is skipped. The empty
 * state that produces is correct, and is worth remembering when this screen
 * looks empty against data that appears to exist.
 */
export function InsightsScreen() {
  const { data: insights, isPending, isError, error, refetch } = useInsights();

  if (isPending) {
    return (
      <ScreenContainer>
        <PageHeader title="Insights" />
        <InsightsSkeleton />
      </ScreenContainer>
    );
  }

  if (isError) {
    return (
      <ScreenContainer>
        <PageHeader title="Insights" />
        <EmptyState
          title="Couldn't load your practice"
          description={describeLoadError(error)}
        />
      </ScreenContainer>
    );
  }

  if (!insights) {
    return (
      <ScreenContainer>
        <PageHeader title="Insights" />
        <EmptyState
          icon={ChartLine}
          title="No practice recorded yet"
          description="Record yourself playing a piece and InTempo will show you where the tempo held and where it drifted."
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer onRefresh={() => refetch()}>
      <PageHeader eyebrow={windowLabel(insights.windowDays)} title="Insights" />

      <Card emphasis>
        <Text variant="sectionLabel" color="textSecondary">
          Tempo tendency
        </Text>

        <Text variant="pieceTitle" style={styles.tendency}>
          {formatTendency(insights.verdict)}
        </Text>

        <Text variant="body" color="textSecondary" style={styles.detail}>
          {formatTendencyDetail(insights.verdict, insights.sessions)}
        </Text>

        <DeviationBar
          deviationPct={insights.meanDeviationPct}
          tolerance={insights.tolerance}
          accessibilityLabel={`${formatTendency(insights.verdict)} across your recent practice`}
          style={styles.bar}
        />

        {/*
          A bar that grows from the middle is only legible if the sides are
          named. One legend for the screen — the rows below inherit the reading.
        */}
        <View style={styles.legend}>
          <Text variant="metadataSmall" color="textTertiary">
            Behind the beat
          </Text>
          <Text variant="metadataSmall" color="textTertiary">
            Ahead of the beat
          </Text>
        </View>
      </Card>

      <SectionHeader label="By piece" style={styles.section} />

      <View style={styles.pieces}>
        {insights.pieces.map((piece, index) => (
          <FadeIn key={piece.pieceId} index={index}>
            <PieceInsightRow insight={piece} />
          </FadeIn>
        ))}
      </View>
    </ScreenContainer>
  );
}

function windowLabel(days: number): string {
  return days === 1 ? 'Last day' : `Last ${days} days`;
}

const styles = StyleSheet.create({
  tendency: {
    marginTop: spacing.sm,
  },
  detail: {
    marginTop: spacing.sm,
  },
  bar: {
    marginTop: spacing.xl,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  pieces: {
    gap: spacing.md,
  },
});
