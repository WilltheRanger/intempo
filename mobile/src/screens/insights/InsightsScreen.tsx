import { useNavigation } from '@react-navigation/native';
import { ChartLine } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { FadeIn } from '../../components/motion';
import {
  Card,
  EmptyState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { InsightsSkeleton } from '../../components/skeletons';
import { useInsights } from '../../data/hooks/useInsights';
import { useRecentTakes } from '../../data/hooks/useLatestTake';
import { describeLoadError } from '../../data/api/describeError';
import { spacing } from '../../design';
import {
  formatLastPracticedShort,
  joinMetadata,
} from '../../lib/format';
import { formatTendency, formatTendencyDetail } from '../../lib/tempo';
import type { TabScreenNavigation } from '../../navigation/types';
import { TodayRow } from '../today/TodayRow';
import { DeviationBar } from './DeviationBar';
import { PieceInsightRow } from './PieceInsightRow';

/**
 * Practice history that explains the pattern and makes it useful.
 *
 * All metrics come from finished analyses. The screen keeps the aggregate
 * tendency, then turns it into a next practice action and links back to the
 * individual takes that produced it.
 */
export function InsightsScreen() {
  const navigation = useNavigation<TabScreenNavigation<'Insights'>>();
  const insightsQuery = useInsights();
  const recentTakes = useRecentTakes(5);
  const {
    data: insights,
    isPending,
    isError,
    error,
  } = insightsQuery;

  async function refresh() {
    await Promise.all([insightsQuery.refetch(), recentTakes.refetch()]);
  }

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
      <ScreenContainer onRefresh={refresh}>
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
      <ScreenContainer onRefresh={refresh}>
        <PageHeader title="Insights" />
        <EmptyState
          icon={ChartLine}
          title="No practice recorded yet"
          description="Record yourself playing a piece and InTempo will show you where the tempo held and where it drifted."
        />
      </ScreenContainer>
    );
  }

  const focus = insights.pieces[0] ?? null;
  const takes = recentTakes.data ?? [];

  return (
    <ScreenContainer onRefresh={refresh}>
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

        <View style={styles.legend}>
          <Text variant="metadataSmall" color="textTertiary">
            Behind the beat
          </Text>
          <Text variant="metadataSmall" color="textTertiary">
            Ahead of the beat
          </Text>
        </View>
      </Card>

      <Card style={styles.stats}>
        <Metric value={String(insights.sessions)} label="Sessions" />
        <Metric value={String(insights.pieces.length)} label="Pieces" />
        <Metric value={String(insights.windowDays)} label="Days" />
      </Card>

      {focus ? (
        <FadeIn index={0}>
          <View style={styles.section}>
            <SectionHeader label="Next focus" />
            <Card>
              <Text variant="pieceTitle">{focus.title}</Text>
              <Text variant="body" color="textSecondary" style={styles.detail}>
                This piece shows your strongest timing pattern across{' '}
                {sessionLabel(focus.sessions)}. Record another comfortable take
                and compare it with the last one.
              </Text>
              <SecondaryButton
                label="Practice this piece"
                onPress={() =>
                  navigation.navigate('Record', { pieceId: focus.pieceId })
                }
                style={styles.action}
              />
            </Card>
          </View>
        </FadeIn>
      ) : null}

      {takes.length > 0 ? (
        <FadeIn index={1}>
          <View style={styles.section}>
            <SectionHeader label="Recent sessions" />
            <Card>
              {takes.map((take, index) => (
                <TodayRow
                  key={take.id}
                  title={take.pieceTitle}
                  detail={joinMetadata([
                    formatLastPracticedShort(take.recordedAt),
                    `${take.targetBpm} BPM`,
                    formatTendency(take.verdict),
                  ])}
                  onPress={() =>
                    navigation.navigate('Verdict', { analysisId: take.id })
                  }
                  last={index === takes.length - 1}
                />
              ))}
            </Card>
          </View>
        </FadeIn>
      ) : null}

      <SectionHeader label="By piece" style={styles.section} />

      <View style={styles.pieces}>
        {insights.pieces.map((piece, index) => (
          <FadeIn key={piece.pieceId} index={index + 2}>
            <PieceInsightRow insight={piece} />
          </FadeIn>
        ))}
      </View>
    </ScreenContainer>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.metric}>
      <Text variant="pieceTitle">{value}</Text>
      <Text variant="metadataSmall" color="textSecondary" style={styles.metricLabel}>
        {label}
      </Text>
    </View>
  );
}

function windowLabel(days: number): string {
  return days === 1 ? 'Last day' : `Last ${days} days`;
}

function sessionLabel(sessions: number): string {
  return sessions === 1 ? '1 session' : `${sessions} sessions`;
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
  stats: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
  },
  metricLabel: {
    marginTop: spacing.xs,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  action: {
    marginTop: spacing.lg,
  },
  pieces: {
    gap: spacing.md,
  },
});
