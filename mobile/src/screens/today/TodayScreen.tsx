import { useNavigation } from '@react-navigation/native';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { FadeIn } from '../../components/motion';
import { AddPieceSheet } from '../../components/pieces/AddPieceSheet';
import {
  Avatar,
  Card,
  EmptyState,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { ContinueSkeleton } from '../../components/skeletons';
import { useInsights } from '../../data/hooks/useInsights';
import { useRecentTakes } from '../../data/hooks/useLatestTake';
import { useMe } from '../../data/hooks/useMe';
import { useCurrentPiece, useLibrary } from '../../data/hooks/usePieces';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { usePreferences } from '../../data/preferences';
import type { Piece, Verdict } from '../../data/types';
import { describeLoadError } from '../../data/api/describeError';
import { spacing } from '../../design';
import {
  formatLastPracticedShort,
  joinMetadata,
} from '../../lib/format';
import { getGreeting } from '../../lib/greeting';
import { formatTempo, formatTendency } from '../../lib/tempo';
import { motion } from '../../design';
import { suggestionsFor } from '../../lib/today';
import type { AddPieceOption, TabScreenNavigation } from '../../navigation/types';
import { WarmupPanel } from './WarmupPanel';
import { PracticeCard } from './PracticeCard';
import { TodayRow } from './TodayRow';

const AVATAR_SIZE = 52;
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
const AVATAR_TARGET = 52;
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
  const recentTakes = useRecentTakes(3);
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
      recentTakes.refetch(),
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

  const takes = recentTakes.data ?? [];
  const take = takes[0] ?? null;

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
          <View style={styles.practiceHeader}>
            <SectionHeader
              label="Continue practicing"
              style={styles.practiceHeaderLabel}
            />
            <PrimaryButton
              label="New piece"
              icon={Plus}
              size="compact"
              onPress={() => setAddSheetVisible(true)}
            />
          </View>
          <PracticeCard
            piece={piece}
            workingBpm={workingBpm}
            // Only when it is genuinely this piece's take. Against the API it
            // always is; a fixture or a deleted score could disagree, and a
            // verdict about a different piece on this card would be a lie.
            lastTakeHeadline={hasCurrentTake && take ? take.headline : null}
            onContinue={() => openPractice(piece)}
          />

          <FadeIn index={0}>
            <View style={styles.section}>
              <SectionHeader label="Today's lesson" />
              <LessonCard
                lesson={lessonFor(hasCurrentTake && take ? take.verdict : null, piece.title)}
                onTry={() => openPractice(piece)}
              />
            </View>
          </FadeIn>

          <FadeIn index={1}>
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

          {takes.length > 0 ? (
            <FadeIn index={2}>
              <View style={styles.section}>
                <SectionHeader label="Recent practice" />
                <Card>
                  {takes.map((recentTake, index) => (
                    <TodayRow
                      key={recentTake.id}
                      title={recentTake.pieceTitle}
                      detail={joinMetadata([
                        formatLastPracticedShort(recentTake.recordedAt),
                        formatTempo(recentTake.targetBpm, recentTake.tempoBeatUnit),
                        formatTendency(recentTake.verdict),
                      ])}
                      onPress={() =>
                        navigation.navigate('Verdict', {
                          analysisId: recentTake.id,
                        })
                      }
                      last={index === takes.length - 1}
                    />
                  ))}
                </Card>
              </View>
            </FadeIn>
          ) : null}
        </View>

        <View
          style={[
            styles.secondaryColumn,
            isWide ? styles.secondaryColumnWide : styles.secondaryColumnNarrow,
          ]}
        >
          <FadeIn index={3}>
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
                    ? `Stay at ${formatTempo(workingBpm, piece.score?.tempo_beat_unit)} and record one more honest run. Comparing two takes shows whether the change held.`
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
            <FadeIn index={4}>
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
            <FadeIn index={5}>
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

      <AddPieceSheet
        visible={addSheetVisible}
        onClose={() => setAddSheetVisible(false)}
        onSelect={handleSelectOption}
      />
    </ScreenContainer>
  );
}

interface Lesson {
  title: string;
  body: string;
  exercise: string;
}

function lessonFor(verdict: Verdict | null, pieceTitle: string): Lesson {
  if (verdict === 'rushing' || verdict === 'slight_rush') {
    return {
      title: 'Make room between the clicks',
      body:
        'Rushing often starts in the space between beats. Subdivide before you play so the next note has somewhere exact to land.',
      exercise:
        'Count “one-and-two-and” through one phrase, then play it at the same tempo without counting aloud.',
    };
  }

  if (verdict === 'dragging' || verdict === 'slight_drag') {
    return {
      title: 'Carry the pulse through hard notes',
      body:
        'Dragging often begins when the hands wait for the beat before preparing. Let the subdivision keep moving while you set up the next note.',
      exercise:
        'Tap steady eighth notes through the hardest phrase first, then play while keeping that motion in your head.',
    };
  }

  if (verdict === 'on_tempo') {
    return {
      title: 'Repeat the result before adding speed',
      body:
        'One steady take is a good sign. A second comparable take shows whether the pulse is dependable rather than accidental.',
      exercise:
        'Keep the same tempo and record one more take of the same passage before changing anything.',
    };
  }

  return {
    title: 'Start with an honest baseline',
    body:
      'A useful first take is not your fastest attempt. Choose a tempo where you can keep moving after a mistake and hear what your timing normally does.',
    exercise: `Record one uninterrupted take of ${pieceTitle}. Do not restart—use it as the starting point.`,
  };
}

function LessonCard({ lesson, onTry }: { lesson: Lesson; onTry: () => void }) {
  return (
    <Card>
      <Text variant="pieceTitle">{lesson.title}</Text>
      <Text variant="body" color="textSecondary" style={styles.lessonBody}>
        {lesson.body}
      </Text>
      <View style={styles.lessonExercise}>
        <Text variant="sectionLabel" color="textSecondary">
          Try this
        </Text>
        <Text variant="body" style={styles.lessonExerciseText}>
          {lesson.exercise}
        </Text>
      </View>
      <SecondaryButton
        label="Try it in practice"
        onPress={onTry}
        style={styles.lessonAction}
      />
    </Card>
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
  practiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  practiceHeaderLabel: {
    flex: 1,
    marginBottom: 0,
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
  lessonBody: {
    marginTop: spacing.sm,
  },
  lessonExercise: {
    marginTop: spacing.xl,
  },
  lessonExerciseText: {
    marginTop: spacing.xs,
  },
  lessonAction: {
    marginTop: spacing.lg,
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
