import { useNavigation } from '@react-navigation/native';
import { ChartLine } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { FadeIn } from '../../components/motion';
import {
  EmptyState,
  PageHeader,
  ScreenContainer,
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
import { focusReason, windowLabel } from './copy';

/**
 * Practice history that explains the pattern and makes it useful.
 *
 * All metrics come from finished analyses. The screen keeps the aggregate
 * tendency, then turns it into a next practice action and links back to the
 * individual takes that produced it.
 *
 * **The finding is the title.** This screen used to open with "Insights" set
 * in 36pt serif — the one word on it that says nothing, since the tab under
 * the reader's thumb is already labelled that — and put the sentence a
 * musician came for, "You tend to rush", a size down inside a white box. Four
 * boxes in fact, stacked on the page ground, each carrying the same visual
 * weight: from three feet away the screen read as a column of white rectangles
 * with no first thing to look at (§3 laws 3, 4 and 8). The screen name moved
 * into the eyebrow, where a screen the tab bar already names belongs, and the
 * verdict took the title.
 *
 * **Nothing here is a card any more.** The tendency, its bar and its two end
 * labels are one thought, and typography groups them — a border around them
 * only says a second time what the type already said. The lists below are
 * ruled rows, which is what the Library beside them is, and it is the same
 * list of the same pieces.
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
  const tendency = formatTendency(insights.verdict);

  return (
    <ScreenContainer onRefresh={refresh}>
      <PageHeader
        eyebrow={`Insights · ${windowLabel(insights.windowDays)}`}
        title={tendency}
      />

      <Text variant="body" color="textSecondary">
        {formatTendencyDetail(insights.verdict, insights.sessions)}
      </Text>

      <DeviationBar
        deviationPct={insights.meanDeviationPct}
        tolerance={insights.tolerance}
        accessibilityLabel={`${tendency} across your recent practice`}
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

      {focus ? (
        <FadeIn index={0}>
          <View style={styles.section}>
            <SectionHeader label="Next focus" />
            <TodayRow
              title={focus.title}
              detail={focusReason(focus.sessions)}
              detailLines={3}
              onPress={() =>
                navigation.navigate('Record', { pieceId: focus.pieceId })
              }
              last
            />
          </View>
        </FadeIn>
      ) : null}

      {takes.length > 0 ? (
        <FadeIn index={1}>
          <View style={styles.section}>
            <SectionHeader label="Recent sessions" />
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
          </View>
        </FadeIn>
      ) : null}

      <View style={styles.section}>
        {/* **Where the row of big numbers went.** "34 sessions" is already in
            the sentence under the title and "30 days" is already in the
            eyebrow, so two thirds of that block was the screen repeating
            itself in a larger typeface. The third, a count of pieces, is one
            scroll of this list — and a heading reading "4 pieces" beside
            "Next focus" and "Recent sessions" names a quantity where its
            neighbours name a section. */}
        <SectionHeader label="By piece" />
        {insights.pieces.map((piece, index) => (
          <FadeIn key={piece.pieceId} index={index + 2}>
            <PieceInsightRow
              insight={piece}
              last={index === insights.pieces.length - 1}
              onPress={() =>
                navigation.navigate('PieceDetail', { pieceId: piece.pieceId })
              }
            />
          </FadeIn>
        ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
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
});
