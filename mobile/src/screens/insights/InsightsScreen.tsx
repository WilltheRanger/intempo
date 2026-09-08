import { useNavigation } from '@react-navigation/native';
import { ChartLine } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FadeIn } from '../../components/motion';
import { AddPieceSheet } from '../../components/pieces/AddPieceSheet';
import {
  EmptyState,
  PageHeader,
  ScreenContainer,
  SectionHeader,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { InsightsSkeleton } from '../../components/skeletons';
import { useInsights } from '../../data/hooks/useInsights';
import { useLibrary } from '../../data/hooks/usePieces';
import { useRecentTakes } from '../../data/hooks/useLatestTake';
import { describeLoadError } from '../../data/api/describeError';
import { spacing } from '../../design';
import {
  formatLastPracticedShort,
  joinMetadata,
} from '../../lib/format';
import { readTendency } from '../../lib/insights/tendency';
import { compareLatest } from '../../lib/insights/comparison';
import { formatVerdict } from '../../lib/tempo';
import type { TabScreenNavigation } from '../../navigation/types';
import { TodayRow } from '../today/TodayRow';
import { DeviationBar } from './DeviationBar';
import { PieceInsightRow } from './PieceInsightRow';
import { firstStep, focusReason, windowLabel } from './copy';
import { useAddPieceOption } from '../../navigation/useAddPieceOption';

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
  const [showMoreHistory, setShowMoreHistory] = useState(false);
  const recentTakes = useRecentTakes(20);
  // Shares React Query's cache with the Library tab, so on a phone that has
  // opened the app this costs nothing. It is read for one reason: what to
  // offer a musician with no practice history depends on whether they have
  // anything to record yet.
  const library = useLibrary();
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const {
    data: insights,
    isPending,
    isError,
    error,
  } = insightsQuery;

  async function refresh() {
    await Promise.all([insightsQuery.refetch(), recentTakes.refetch()]);
  }

  const handleSelectOption = useAddPieceOption(() =>
    setAddSheetVisible(false),
  );

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
          fill
          title="Couldn't load your practice"
          description={describeLoadError(error)}
          actionLabel={insightsQuery.isFetching ? 'Trying…' : 'Try again'}
          onActionPress={() => void refresh()}
          actionDisabled={insightsQuery.isFetching}
        />
      </ScreenContainer>
    );
  }

  if (!insights) {
    // Which way out this offers depends on the library — see `firstStep`.
    const step = firstStep(library.data?.length ?? 0);
    return (
      <ScreenContainer onRefresh={refresh}>
        <PageHeader title="Insights" />
        <EmptyState
          fill
          icon={ChartLine}
          title="No practice recorded yet"
          description={step.description}
          actionLabel={step.label}
          onActionPress={() => {
            if (step.destination === 'add') {
              setAddSheetVisible(true);
              return;
            }
            navigation.navigate('Library');
          }}
        />

        <AddPieceSheet
          visible={addSheetVisible}
          onClose={() => setAddSheetVisible(false)}
          onSelect={handleSelectOption}
        />
      </ScreenContainer>
    );
  }

  const focus = insights.pieces[0] ?? null;
  const history = recentTakes.data ?? [];
  const comparison = compareLatest(history);
  const takes = showMoreHistory ? history : history.slice(0, 5);
  // Which of the two findings this window is — the direction, or the wandering
  // that a direction cannot describe. The rule and the words are in
  // `lib/insights/tendency.ts`, where they can be tested.
  const tendency = readTendency(insights);

  return (
    <ScreenContainer onRefresh={refresh}>
      <PageHeader
        eyebrow={`Insights · ${windowLabel(insights.windowDays)}`}
        title={tendency.title}
      />

      <Text variant="body" color="textSecondary">
        {tendency.detail}
      </Text>

      <DeviationBar
        deviationPct={insights.meanDeviationPct}
        spreadPct={tendency.showsSpread ? insights.spreadPct : undefined}
        tolerance={insights.tolerance}
        accessibilityLabel={tendency.spoken}
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

      {comparison ? (
        <View style={styles.section}>
          <SectionHeader label="Comparable takes" />
          <Text variant="pieceTitle">{comparison.latest.pieceTitle}</Text>
          <Text variant="body" color="textSecondary" style={styles.retrySpacing}>
            Average bar deviation: {comparison.previousDeviation.toFixed(1)}% previously
            {' → '}{comparison.latestDeviation.toFixed(1)}% in your latest take.
          </Text>
          <Text variant="metadataSmall" color="textSecondary" style={styles.retrySpacing}>
            Same score, tempo, instrument and practice settings. Lower means bar
            averages were closer to the beat—not an overall playing score.
          </Text>
          <SecondaryButton label="Open previous take" style={styles.retrySpacing}
            onPress={() => navigation.navigate('Verdict', { analysisId: comparison.previous.id })} />
          <SecondaryButton label="Open latest take" style={styles.retrySpacing}
            onPress={() => navigation.navigate('Verdict', { analysisId: comparison.latest.id })} />
        </View>
      ) : null}

      {recentTakes.isError ? (
        <View style={styles.section}>
          <SectionHeader label="Recent sessions" />
          <Text variant="body" color="textSecondary">
            Your recent sessions couldn't refresh. Your practice summary is still available.
          </Text>
          <SecondaryButton
            label={recentTakes.isFetching ? 'Trying…' : 'Retry recent sessions'}
            disabled={recentTakes.isFetching}
            style={styles.retrySpacing}
            onPress={() => { void recentTakes.refetch(); }}
          />
        </View>
      ) : null}

      {takes.length > 0 ? (
        <FadeIn index={1}>
          <View style={styles.section}>
            <SectionHeader label="Recent sessions" />
            <Text variant="metadataSmall" color="textSecondary">
              Open a session to revisit its recording and bar-by-bar feedback.
              Compare the same passage at the same tempo; different takes aren't
              automatically a measure of improvement.
            </Text>
            {takes.map((take, index) => (
              <TodayRow
                key={take.id}
                title={take.pieceTitle}
                detail={joinMetadata([
                  formatLastPracticedShort(take.recordedAt),
                  `${take.targetBpm} BPM`,
                  // `formatVerdict`, not `formatTendency`: this row is one
                  // recording. The tendency wording is a claim about a habit —
                  // its own comment says a single take cannot see one — and it
                  // rendered here as "2 days ago · 76 BPM · You tend to rush",
                  // a sentence about a musician's playing wedged into a list of
                  // facts about one file.
                  formatVerdict(take.verdict),
                ])}
                onPress={() =>
                  navigation.navigate('Verdict', { analysisId: take.id })
                }
                last={index === takes.length - 1}
              />
            ))}
            {history.length > 5 ? (
              <SecondaryButton
                label={showMoreHistory ? 'Show fewer sessions' : 'Show up to 20 recent sessions'}
                onPress={() => setShowMoreHistory((value) => !value)}
                style={styles.retrySpacing}
              />
            ) : null}
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
  retrySpacing: {
    marginTop: spacing.md,
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
});
