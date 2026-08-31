import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { FadeIn } from '../../components/motion';
import { AddPieceSheet } from '../../components/pieces/AddPieceSheet';
import {
  Avatar,
  Card,
  EmptyState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { ContinueSkeleton } from '../../components/skeletons';
import { useInsights } from '../../data/hooks/useInsights';
import { useLatestTake } from '../../data/hooks/useLatestTake';
import { useMe } from '../../data/hooks/useMe';
import { useCurrentPiece, useLibrary } from '../../data/hooks/usePieces';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { usePreferences } from '../../data/preferences';
import type { Piece } from '../../data/types';
import { describeLoadError } from '../../data/api/describeError';
import { spacing } from '../../design';
import { getGreeting } from '../../lib/greeting';
import { formatTendency } from '../../lib/tempo';
import { motion } from '../../design';
import { suggestionsFor } from '../../lib/today';
import type { AddPieceOption, TabScreenNavigation } from '../../navigation/types';
import { WarmupPanel } from './WarmupPanel';
import { PracticeCard } from './PracticeCard';
import { TodayRow } from './TodayRow';

const AVATAR_SIZE = 36;
const WIDE_HOME_BREAKPOINT = 900;

/**
 * Tappable box around the mark.
 *
 * Bigger than the mark, and pulled back in by the difference so the header row
 * keeps the height the greeting gives it — a taller row would push the whole
 * screen down. `hitSlop` would have done this too, but only on device: it has
 * no effect under react-native-web, so the target couldn't be verified in the
 * one place this build can be driven. A real box behaves the same everywhere.
 */
const AVATAR_TARGET = 48;
const AVATAR_INSET = (AVATAR_TARGET - AVATAR_SIZE) / 2;

/**
 * Today is a practice dashboard, not a miniature library.
 *
 * The first column gets someone playing: resume the current piece, then warm
 * up. The supporting column answers the next three useful questions: what
 * should this take accomplish, what else needs attention, and what pattern is
 * showing up across recent sessions. Every block is either an action or an
 * explanation of real practice data; decorative trivia does not compete with
 * the session a musician came here to start.
 */
export function TodayScreen() {
  const navigation = useNavigation<TabScreenNavigation<'Today'>>();
  const { width: viewportWidth } = useWindowDimensions();
  const isWide = viewportWidth >= WIDE_HOME_BREAKPOINT;
  const currentPiece = useCurrentPiece();
  const library = useLibrary();
  const insights = useInsights();
  const latestTake = useLatestTake();
  const me = useMe();
  const [addSheetVisible, setAddSheetVisible] = useState(false);

  // The working tempo is local and per piece, so this subscribes rather than
  // reading once — changing it on the Record screen has to show here.
  usePracticeTempos();
  // Likewise the instrument: switching it in the profile has to change the
  // excerpt on the way back, not on the next cold start.
  const { instrument } = usePreferences();

  async function refresh() {
    await Promise.all([
      currentPiece.refetch(),
      library.refetch(),
      insights.refetch(),
      latestTake.refetch(),
      me.refetch(),
    ]);
  }

  const piece = currentPiece.data ?? null;

  // Straight to a take: what someone means by "continue practicing" is
  // recording one. Reading the score without recording is `PieceScore`,
  // reached from the piece itself.
  function openPractice(target: Piece) {
    navigation.navigate('Record', { pieceId: target.id });
  }

  // The same three destinations the Library's button reaches, by the same
  // route — one definition of "add a piece", not two that can drift.
  function handleSelectOption(option: AddPieceOption) {
    setAddSheetVisible(false);
    // Let the sheet finish dismissing before the push, so the two animations
    // don't overlap.
    setTimeout(() => {
      if (option === 'scan') {
        navigation.navigate('Scanner');
        return;
      }
      navigation.navigate('AddPiece', { option });
    }, motion.fast);
  }

  const take = latestTake.data ?? null;

  const { attention, neglected } = suggestionsFor({
    pieces: library.data ?? [],
    insights: insights.data ?? null,
    excludeIds: [piece?.id ?? null, take?.pieceId ?? null],
  });

  const summary = insights.data ?? null;

  const avatar = me.data ? (
    <Pressable
      onPress={() => navigation.navigate('Profile')}
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
    >
      <Avatar source={me.data.avatarUrl} size={AVATAR_SIZE} />
    </Pressable>
  ) : null;

  const header = <PageHeader title={getGreeting()} action={avatar} />;

  if (currentPiece.isPending) {
    return (
      <ScreenContainer contentStyle={styles.page}>
        {header}
        <ContinueSkeleton />
      </ScreenContainer>
    );
  }

  if (currentPiece.isError) {
    return (
      <ScreenContainer onRefresh={refresh} contentStyle={styles.page}>
        {header}
        <EmptyState
          title="Couldn't load your pieces"
          description={describeLoadError(currentPiece.error)}
        />
      </ScreenContainer>
    );
  }

  // A brand-new account lands here, and this used to be a dead end: it told
  // them to photograph sheet music and the only thing on the screen they could
  // press was their own avatar. The instruction named an action the screen did
  // not offer, and the way to do it was a tab away behind a button they had no
  // reason to look for. The sheet is the Library's, shared rather than
  // duplicated, so all three routes in are offered from the first screen.
  if (!piece) {
    return (
      <ScreenContainer onRefresh={refresh} contentStyle={styles.page}>
        {header}
        <EmptyState
          title="Nothing to practice yet"
          description="Add a piece of sheet music and it will show up here."
          actionLabel="Add a piece"
          onActionPress={() => setAddSheetVisible(true)}
        />
        <AddPieceSheet
          visible={addSheetVisible}
          onClose={() => setAddSheetVisible(false)}
          onSelect={handleSelectOption}
        />
      </ScreenContainer>
    );
  }

  const workingBpm = practiceTempo.for(piece.id, piece.markedBpm);
  const hasCurrentTake = take?.pieceId === piece.id;
  const summaryDetail = summary
    ? `Across ${summary.sessions === 1 ? '1 session' : `${summary.sessions} sessions`} in the last ${summary.windowDays} days`
    : '';

  return (
    <ScreenContainer onRefresh={refresh} contentStyle={styles.page}>
      {header}

      <View style={[styles.dashboard, isWide && styles.dashboardWide]}>
        <View style={styles.primaryColumn}>
          <SectionHeader label="Continue practicing" />
          <PracticeCard
            piece={piece}
            workingBpm={workingBpm}
            // Only when it is genuinely this piece's take. Against the API it
            // always is; a fixture or a deleted score could disagree, and a
            // verdict about a different piece on this card would be a lie.
            lastTakeHeadline={hasCurrentTake ? take.headline : null}
            onContinue={() => openPractice(piece)}
          />

          <FadeIn index={0}>
            <View style={styles.section}>
              <SectionHeader label="Warmup" />
              <Card>
                <WarmupPanel
                  instrument={instrument}
                  onStart={() => navigation.navigate('Warmup')}
                />
              </Card>
            </View>
          </FadeIn>
        </View>

        <View
          style={[
            styles.secondaryColumn,
            isWide ? styles.secondaryColumnWide : styles.secondaryColumnNarrow,
          ]}
        >
          <FadeIn index={1}>
            <View>
              <SectionHeader label="Practice focus" />
              <Card>
                <Text variant="pieceTitle">
                  {hasCurrentTake
                    ? 'Make the next take comparable'
                    : 'Set your first benchmark'}
                </Text>
                <Text
                  variant="body"
                  color="textSecondary"
                  style={styles.focusText}
                >
                  {hasCurrentTake
                    ? `Stay at ${workingBpm} BPM and record one more honest run. Comparing two takes shows whether the change held.`
                    : `Record one honest run of ${piece.title}. InTempo will map where your tempo holds and where it drifts.`}
                </Text>
                <SecondaryButton
                  label={hasCurrentTake ? 'Record another take' : 'Record first take'}
                  onPress={() => openPractice(piece)}
                  style={styles.focusAction}
                />
              </Card>
            </View>
          </FadeIn>

          {attention || neglected ? (
            <FadeIn index={2}>
              <View style={styles.section}>
                <SectionHeader label="Repertoire queue" />
                {attention ? (
                  <TodayRow
                    title={attention.title}
                    detail={attention.detail}
                    onPress={() =>
                      navigation.navigate('PieceDetail', { pieceId: attention.pieceId })
                    }
                    last={!neglected}
                  />
                ) : null}
                {neglected ? (
                  <TodayRow
                    title={neglected.title}
                    detail={neglected.detail}
                    onPress={() =>
                      navigation.navigate('PieceDetail', { pieceId: neglected.pieceId })
                    }
                    last
                  />
                ) : null}
              </View>
            </FadeIn>
          ) : null}

          {summary ? (
            <FadeIn index={3}>
              <View style={styles.section}>
                <SectionHeader label="Practice snapshot" />
                <TodayRow
                  title={formatTendency(summary.verdict)}
                  detail={summaryDetail}
                  onPress={() => navigation.navigate('Insights')}
                  last
                />
              </View>
            </FadeIn>
          ) : null}
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  page: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
  },
  dashboard: {
    width: '100%',
  },
  dashboardWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing['3xl'],
  },
  primaryColumn: {
    flex: 1,
    minWidth: 0,
  },
  secondaryColumn: {
    minWidth: 0,
  },
  secondaryColumnWide: {
    width: 340,
  },
  secondaryColumnNarrow: {
    marginTop: spacing['2xl'],
  },
  avatar: {
    width: AVATAR_TARGET,
    height: AVATAR_TARGET,
    margin: -AVATAR_INSET,
    alignItems: 'center',
    justifyContent: 'center',
    // No vertical nudge: the row centres the mark on the greeting's line box,
    // and the greeting's ink — cap of "G" down to the tail of "g" — is centred
    // in that box to within a fifth of a point. Measured off the rendered
    // type, not the font metrics.
  },
  pressed: {
    opacity: 0.6,
  },
  focusText: {
    marginTop: spacing.sm,
  },
  focusAction: {
    marginTop: spacing.lg,
  },
  section: {
    // One step tighter than it was. At 32pt the blocks read as separate pages
    // of a document rather than as parts of one screen — which is most of what
    // made this feel like a web page.
    marginTop: spacing['2xl'],
  },
});
