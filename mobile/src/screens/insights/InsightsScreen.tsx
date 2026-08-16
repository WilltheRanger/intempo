import { ChartLine } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import {
  Card,
  EmptyState,
  LoadingState,
  PageHeader,
  ScreenContainer,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { useInsights } from '../../data/hooks/useInsights';
import { spacing } from '../../design';
import { formatTendency, formatTendencyDetail } from '../../lib/tempo';
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
 * Nothing behind this is live yet. `/v1/analyses` is unbuilt, so the numbers
 * come from fixtures — but every field maps to a real column, and the verdicts
 * are classified from the deviations by the same thresholds the pipeline will
 * use, so no claim here is one the backend won't be able to make.
 */
export function InsightsScreen() {
  const { data: insights, isPending, isError } = useInsights();

  if (isPending) {
    return (
      <ScreenContainer>
        <PageHeader title="Insights" />
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (isError) {
    return (
      <ScreenContainer>
        <PageHeader title="Insights" />
        <EmptyState
          title="Couldn't load your practice"
          description="Check your connection and try again."
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
    <ScreenContainer>
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
          bpmDeviation={insights.meanBpmDeviation}
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
        {insights.pieces.map((piece) => (
          <PieceInsightRow key={piece.pieceId} insight={piece} />
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
