import { useNavigation } from '@react-navigation/native';
import { ChartLine, ChevronDown } from '../../components/icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FadeIn } from '../../components/motion';
import { AddPieceSheet } from '../../components/pieces/AddPieceSheet';
import {
  EmptyState,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { InsightsSkeleton } from '../../components/skeletons';
import { useInsights } from '../../data/hooks/useInsights';
import { useLibrary } from '../../data/hooks/usePieces';
import { useRecentTakes } from '../../data/hooks/useLatestTake';
import { describeLoadError } from '../../data/describeLoadError';
import { BORDER_WIDTH, colors, fontFamily, radii, spacing } from '../../design';
import { readTendency } from '../../lib/insights/tendency';
import { sessionTrendFrom } from '../../lib/insights/sessionTrend';
import { barsLabel, worthALook } from '../../lib/insights/passageDrift';
import type { TabScreenNavigation } from '../../navigation/types';
import { SessionTrendChart } from '../../components/charts/SessionTrendChart';
import { PassageChart } from './PassageChart';
import { PieceInsightRow } from './PieceInsightRow';
import { firstStep, focusReason, windowLabel } from './copy';
import { useAddPieceOption } from '../../navigation/useAddPieceOption';
import { loadStateFor } from '../../lib/loadState';

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
  const [showAll, setShowAll] = useState(false);
  const recentTakes = useRecentTakes(20);
  // Shares React Query's cache with the Library tab, so on a phone that has
  // opened the app this costs nothing. It is read for one reason: what to
  // offer a musician with no practice history depends on whether they have
  // anything to record yet.
  const library = useLibrary();
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const { data: insights, isError, error } = insightsQuery;
  const load = loadStateFor({ isError, hasData: insights !== undefined });

  async function refresh() {
    await Promise.all([insightsQuery.refetch(), recentTakes.refetch()]);
  }

  const handleSelectOption = useAddPieceOption(() =>
    setAddSheetVisible(false),
  );

  if (load === 'loading') {
    return (
      <ScreenContainer>
        <PageHeader title="Insights" />
        <InsightsSkeleton />
      </ScreenContainer>
    );
  }

  if (load === 'unavailable') {
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

  const history = recentTakes.data ?? [];
  const tendency = readTendency(insights);
  const sessionTrend = sessionTrendFrom(history, insights.tolerance);
  const worth = worthALook(insights.pieces, history, insights.tolerance);
  const focus = worth?.piece ?? null;
  const drift = worth?.drift ?? null;
  const others = insights.pieces;

  function practise(pieceId: string, startAt?: number) {
    navigation.navigate('Record', startAt === undefined ? { pieceId } : { pieceId, startAt });
  }

  return (
    <ScreenContainer onRefresh={refresh}>
      {/*
        The redesign's composition (`redesign/Insights.dc.html`): how many takes
        this is about, then what they say, then the takes themselves. No screen
        title — the tab bar already says Insights — so the finding is the
        heading.
      */}
      <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow}>
        {sessionTrend
          ? `Your last ${sessionTrend.points.length} takes`
          : windowLabel(insights.windowDays)}
      </Text>
      <Text variant="screenTitle" accessibilityRole="header">
        {tendency.title}
      </Text>

      {/*
        One point per take, not per day: students do not practise daily, and a
        calendar axis draws the gaps as flat stretches nobody played. Without
        two takes there is no line, and the sentence carries the finding alone.
      */}
      {sessionTrend ? (
        <SessionTrendChart
          trend={sessionTrend}
          area
          accessibilityLabel={tendency.spoken}
          style={styles.chart}
        />
      ) : (
        <Text variant="body" color="textSecondary" style={styles.detail}>
          {tendency.detail}
        </Text>
      )}

      {focus ? (
        <FadeIn index={0}>
          {/*
            **The one card on the screen**, because it is the one thing here
            that is a recommendation rather than a reading: a piece, where in it
            the trouble is, and the button that goes and practises it.
          */}
          <View style={styles.card}>
            <Text variant="eyebrow" color="textTertiary" style={styles.eyebrowCaps}>
              Worth a look
            </Text>
            <Text variant="pieceTitle" numberOfLines={2} style={styles.cardTitle}>
              {focus.title}
            </Text>
            {drift ? (
              <>
                <View style={styles.passages}>
                  <PassageChart
                    drift={drift}
                    accessibilityLabel={`${focus.title}, passage by passage. ${drift.sentence}`}
                  />
                </View>
                <Text variant="metadata" color="textSecondary" style={styles.sentence}>
                  {drift.sentence}
                </Text>
                <PrimaryButton
                  label={
                    drift.practice
                      ? `Practice ${barsLabel(drift.practice).toLowerCase()}`
                      : 'Practice it again'
                  }
                  onPress={() => practise(focus.pieceId, drift.practice?.from)}
                  style={styles.cardAction}
                />
              </>
            ) : (
              <>
                <Text variant="metadata" color="textSecondary" style={styles.sentence}>
                  {focusReason(focus.sessions)}
                </Text>
                <PrimaryButton
                  label="Practice it"
                  onPress={() => practise(focus.pieceId)}
                  style={styles.cardAction}
                />
              </>
            )}
          </View>
        </FadeIn>
      ) : null}

      {/*
        Every piece, one line each, behind a toggle: the recommended piece is
        the default answer and the rest are there when asked for. A chevron
        that turns is the drawn affordance, and it does the thing it depicts.
      */}
      {others.length > 1 ? (
        <>
          <Pressable
            onPress={() => setShowAll((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showAll }}
            aria-expanded={showAll}
            style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
          >
            <Text variant="metadata" color="accentText" style={styles.toggleLabel}>
              {showAll ? 'Show less' : `See all ${others.length} pieces`}
            </Text>
            {/* Turned on a wrapper: a transform on the icon itself is lost on web. */}
            <View style={showAll ? styles.chevronOpen : undefined}>
              <ChevronDown size={15} strokeWidth={1.8} color={colors.accentText} />
            </View>
          </Pressable>
          {showAll ? (
            <View style={styles.list}>
              <Text variant="eyebrow" color="textTertiary" style={styles.eyebrowCaps}>
                Your pieces
              </Text>
              <View style={styles.rows}>
                {others.map((piece) => (
                  <PieceInsightRow
                    key={piece.pieceId}
                    insight={piece}
                    onPress={() => navigation.navigate('PieceDetail', { pieceId: piece.pieceId })}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : null}

      {recentTakes.isError ? (
        <View style={styles.list}>
          <Text variant="metadata" color="textSecondary">
            Your recent takes couldn&rsquo;t refresh, so the chart may be missing the newest.
          </Text>
          <SecondaryButton
            label={recentTakes.isFetching ? 'Trying…' : 'Try again'}
            disabled={recentTakes.isFetching}
            style={styles.retry}
            onPress={() => {
              void recentTakes.refetch();
            }}
          />
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    textTransform: 'uppercase',
    marginTop: spacing.xl,
    marginBottom: 6,
  },
  eyebrowCaps: {
    textTransform: 'uppercase',
  },
  detail: {
    marginTop: spacing.md,
  },
  chart: {
    marginTop: 22,
  },
  card: {
    marginTop: spacing['2xl'],
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    marginTop: 7,
  },
  passages: {
    marginTop: 14,
  },
  sentence: {
    marginTop: spacing.md,
  },
  cardAction: {
    marginTop: 14,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    minHeight: 44,
    marginTop: 10,
  },
  togglePressed: {
    opacity: 0.55,
  },
  toggleLabel: {
    fontFamily: fontFamily.sansMedium,
  },
  chevronOpen: {
    transform: [{ rotate: '180deg' }],
  },
  list: {
    marginTop: 14,
  },
  rows: {
    marginTop: 7,
  },
  retry: {
    marginTop: spacing.md,
  },
});
