import { useNavigation } from '@react-navigation/native';
import { ChartLine, ChevronDown } from '../../components/icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FadeIn } from '../../components/motion';
import { AddPieceSheet } from '../../components/pieces/AddPieceSheet';
import {
  EmptyState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { InsightsSkeleton } from '../../components/skeletons';
import { useInsights } from '../../data/hooks/useInsights';
import { useLibrary } from '../../data/hooks/usePieces';
import { useRecentTakes } from '../../data/hooks/useLatestTake';
import { describeLoadError } from '../../data/describeLoadError';
import { colors, fontFamily, spacing, ICON_SIZE, ICON_STROKE_WIDTH } from '../../design';
import { readTendency } from '../../lib/insights/tendency';
import { sessionTrendFrom } from '../../lib/insights/sessionTrend';
import { barsLabel, worthALook } from '../../lib/insights/passageTempo';
import type { TabScreenNavigation } from '../../navigation/types';
import { PitchTrendChart } from '../../components/charts/PitchTrendChart';
import { SessionTrendChart } from '../../components/charts/SessionTrendChart';
import { pitchTrendFrom, pitchTrendLine } from '../../lib/insights/pitchTrend';
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
  const passages = worth?.tempo ?? null;
  const others = insights.pieces;
  // How in tune, take by take (`lib/insights/pitchTrend.ts`); nothing at all
  // until a take has been read for pitch.
  const pitchLine = pitchTrendLine(history);
  const pitchTrend = pitchTrendFrom(history);

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
          ? `Last ${sessionTrend.points.length} takes`
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
          height={150}
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
            **Not a card, and not the black button** (the owner, 2026-09-25:
            "fix the visual hierarchy"). It was the one card on the screen,
            with the screen's one solid button in it — the darkest thing on
            the page, so the eye went there before the finding in the title.
            It is a section like "In tune" now, and its action the outlined
            button: still the thing to do next, no longer the first thing seen.
          */}
          <View style={styles.worth}>
            <Text variant="eyebrow" color="textTertiary" style={styles.eyebrowCaps}>
              Worth a look
            </Text>
            <Text variant="pieceTitle" numberOfLines={2} style={styles.worthTitle}>
              {focus.title}
            </Text>
            {passages ? (
              <>
                <View style={styles.passages}>
                  <PassageChart
                    tempo={passages}
                    accessibilityLabel={`${focus.title}, passage by passage. ${passages.sentence}`}
                  />
                </View>
                <Text variant="metadata" color="textSecondary" style={styles.sentence}>
                  {passages.sentence}
                </Text>
                <SecondaryButton
                  label={
                    passages.practice
                      ? `Practice ${barsLabel(passages.practice).toLowerCase()}`
                      : 'Practice it again'
                  }
                  onPress={() => practise(focus.pieceId, passages.practice?.from)}
                  style={styles.worthAction}
                />
              </>
            ) : (
              <>
                <Text variant="metadata" color="textSecondary" style={styles.sentence}>
                  {focusReason(focus.sessions)}
                </Text>
                <SecondaryButton
                  label="Practice it"
                  onPress={() => practise(focus.pieceId)}
                  style={styles.worthAction}
                />
              </>
            )}
          </View>
        </FadeIn>
      ) : null}

      {/*
        **Pitch, beside the timing** (the owner, 2026-09-25): how far the
        typical note sat from their own tuning, take by take. A reading, not a
        recommendation, so no card — the section is its label, its sentence
        and its line.
      */}
      {pitchLine ? (
        <View style={styles.pitch}>
          <Text variant="eyebrow" color="textTertiary" style={styles.eyebrowCaps}>
            In tune
          </Text>
          <Text variant="metadata" color="textSecondary" style={styles.pitchSentence}>
            {pitchLine}
          </Text>
          {pitchTrend ? (
            <PitchTrendChart
              trend={pitchTrend}
              accessibilityLabel={`In tune, take by take. ${pitchLine}`}
              style={styles.pitchChart}
            />
          ) : null}
        </View>
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
              <ChevronDown size={ICON_SIZE.sm} strokeWidth={ICON_STROKE_WIDTH} color={colors.accentText} />
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
  worth: {
    marginTop: spacing['2xl'],
  },
  worthTitle: {
    marginTop: 7,
  },
  passages: {
    marginTop: 14,
  },
  sentence: {
    marginTop: spacing.md,
  },
  worthAction: {
    marginTop: spacing.lg,
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
  pitch: {
    marginTop: spacing['2xl'],
  },
  pitchSentence: {
    marginTop: 6,
  },
  pitchChart: {
    marginTop: spacing.md,
  },
  rows: {
    marginTop: 7,
  },
  retry: {
    marginTop: spacing.md,
  },
});
