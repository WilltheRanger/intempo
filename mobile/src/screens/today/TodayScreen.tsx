import { useNavigation } from '@react-navigation/native';
import { Camera, ChevronRight, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { FadeIn } from '../../components/motion';
import { AddPieceSheet } from '../../components/pieces/AddPieceSheet';
import {
  Avatar,
  EmptyState,
  MetadataRow,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { ContinueSkeleton } from '../../components/skeletons';
import { useInsights } from '../../data/hooks/useInsights';
import { useRecentTakes } from '../../data/hooks/useLatestTake';
import { useMe } from '../../data/hooks/useMe';
import { useCurrentPiece, useLibrary } from '../../data/hooks/usePieces';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { usePreferences } from '../../data/preferences';
import type { Piece } from '../../data/types';
import { describeLoadError } from '../../data/api/describeError';
import {
  cameraCanPhotographAPage,
  deviceHints,
} from '../../lib/platform/pageCamera';
import {
  BORDER_WIDTH,
  colors,
  CONTROL_HEIGHT,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  motion,
  radii,
  spacing,
} from '../../design';
import { getGreeting } from '../../lib/greeting';
import {
  notationSetupLesson,
  practiceLessonFor,
  type PracticeLesson,
} from '../../lib/practiceLesson';
import { formatTempo } from '../../lib/tempo';
import { suggestionsFor } from '../../lib/today';
import type { AddPieceOption, TabScreenNavigation } from '../../navigation/types';
import { WarmupPanel } from './WarmupPanel';
import { TodayRow } from './TodayRow';

const AVATAR_SIZE = 52;

/**
 * The sheet crop under the title.
 *
 * Wide and shallow: it is a *crop* of a page, not a page, and giving it more
 * height would put the second focal point on the screen — the piece's name is
 * the first thing to read here, and a tall photograph would win.
 */
const BANNER_HEIGHT = 96;

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
  const currentPiece = useCurrentPiece();
  const library = useLibrary();
  const insights = useInsights();
  // One: the newest take supplies the headline under the title and the
  // verdict the lesson is chosen from. The list of recent takes moved to
  // Insights, which is where a list of recent takes belongs.
  const recentTakes = useRecentTakes(1);
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
    if ((target.score?.measures.length ?? 0) === 0) {
      navigation.navigate('PieceDetail', { pieceId: target.id });
      return;
    }
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

  /**
   * The greeting, for the screens that have no piece to name.
   *
   * On the main screen it is an eyebrow instead — see `greetingRow`. A "Good
   * morning" set in 36pt serif above a piece title set in 36pt serif is two
   * headings of equal weight and no first thing to look at (§3 law 4), and of
   * the two the greeting is the one that says nothing.
   */
  const header = <PageHeader title={getGreeting()} action={avatar} />;

  if (currentPiece.isPending) {
    return (
      <ScreenContainer>
        {header}
        <ContinueSkeleton />
      </ScreenContainer>
    );
  }

  if (currentPiece.isError) {
    return (
      <ScreenContainer onRefresh={refresh}>
        {header}
        <EmptyState
          title="Couldn't load your pieces"
          description={describeLoadError(currentPiece.error)}
          actionLabel={currentPiece.isFetching ? 'Trying…' : 'Try again'}
          onActionPress={() => void refresh()}
          actionDisabled={currentPiece.isFetching}
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
    /*
      **The first screen a new account ever sees**, and it was composed as
      though it were an error.

      The greeting was the largest thing on it — a `heroTitle` serif "Good
      morning" over a smaller "Nothing to practice yet" and a bordered
      secondary button floating in the middle of five hundred empty points. On
      a screen whose entire job is to get one piece of music in, the greeting
      was the focal point and the one thing to do was the third thing you
      noticed (§3 laws 4 and 7).

      Now the greeting is the eyebrow it should always have been on this
      branch, the proposition is the headline, and the action is in the thumb
      zone. The sentence under it is the only place in the app that says what
      the product *does*; a new account has no other way to find out.
    */
    const canPhotograph = cameraCanPhotographAPage(deviceHints(Platform.OS));
    return (
      <ScreenContainer
        onRefresh={refresh}
        footer={
          <View>
            <PrimaryButton
              // **The camera, not a chooser**, where there is one worth using.
              // Photographing a page is the product; a first piece is one tap
              // rather than two, and the alternatives are still a line below.
              label={canPhotograph ? 'Photograph sheet music' : 'Add a piece'}
              icon={canPhotograph ? Camera : undefined}
              onPress={() =>
                canPhotograph
                  ? navigation.navigate('Scanner')
                  : setAddSheetVisible(true)
              }
            />
            {canPhotograph ? (
              <Text
                variant="metadataSmall"
                color="textSecondary"
                onPress={() => setAddSheetVisible(true)}
                accessibilityRole="button"
                style={styles.otherRoutes}
              >
                Import a file or add one by hand
              </Text>
            ) : null}
          </View>
        }
      >
        <PageHeader
          eyebrow={getGreeting()}
          title="Start with a page of music"
          action={avatar}
        />
        <Text variant="body" color="textSecondary" style={styles.pitch}>
          Photograph a piece you are working on. InTempo reads the notes,
          listens while you play it, and tells you which bars you rushed and
          which you dragged.
        </Text>

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
  const hasNotation = (piece.score?.measures.length ?? 0) > 0;
  const readingNotation =
    piece.transcriptionStatus === 'queued' ||
    piece.transcriptionStatus === 'reading';
  const summaryDetail = summary
    ? `Across ${summary.sessions === 1 ? '1 session' : `${summary.sessions} sessions`} in the last ${summary.windowDays} days`
    : '';

  const lesson = !hasNotation
    ? notationSetupLesson(piece.title, readingNotation)
    : practiceLessonFor({
        verdict: hasCurrentTake && take ? take.verdict : null,
        pieceTitle: piece.title,
        workingBpm,
        beatUnit: piece.score?.tempo_beat_unit,
      });

  return (
    <ScreenContainer
      onRefresh={refresh}
     
      footer={
        <PrimaryButton
          label={readingNotation ? 'See how the reading is going' : 'Continue practice'}
          onPress={() => openPractice(piece)}
        />
      }
    >
      <View style={styles.greetingRow}>
        <Text variant="metadata" color="textTertiary">
          {getGreeting()}
        </Text>
        {avatar}
      </View>

      {/*
        **The piece is the title of this screen.**

        Today used to open with the greeting in 36pt serif and put the piece a
        size down inside a white card — one of five stacked on the page ground.
        The greeting is the least informative thing here and it was the
        loudest. It is an eyebrow now, which is what a greeting is.
      */}
      <Text variant="screenTitle" numberOfLines={3} style={styles.pieceTitle}>
        {piece.title}
      </Text>
      <MetadataRow
        items={[piece.composer, piece.movement, formatTempo(workingBpm, piece.score?.tempo_beat_unit)]}
        style={styles.pieceMeta}
      />

      {/*
        Sheet music is the app's visual identity, so the piece brings its own
        page with it — full bleed, because a crop of engraving inset behind a
        margin reads as a stock photograph.
      */}
      <ScoreThumbnail
        source={piece.thumbnail}
        composer={piece.composer}
        radius={0}
        style={styles.banner}
      />

      {/*
        Why this piece, in the pipeline's own sentence. Quiet: it is the reason
        for the button at the bottom, not a heading of its own.
      */}
      {hasCurrentTake && take?.headline ? (
        <Text variant="body" color="textSecondary" style={styles.headline}>
          {take.headline}
        </Text>
      ) : null}

      <FadeIn index={0}>
        <View style={styles.section}>
          <SectionHeader label={lesson.context} />
          <Text variant="pieceTitle">{lesson.title}</Text>
          <Text variant="body" color="textSecondary" style={styles.lessonBody}>
            {lesson.body}
          </Text>
          {/*
            **The exercise is the lesson.** The rest explains why; this is the
            thing to actually do at the stand, and in the card version it was
            the last of four blocks behind a "Try it in practice" button that
            did the same thing as the button at the bottom of the screen.
          */}
          <Text variant="body" style={styles.lessonExercise}>
            {lesson.exercise}
          </Text>
        </View>
      </FadeIn>

      <FadeIn index={1}>
        <View style={styles.section}>
          <SectionHeader label="Warmup" />
          <WarmupPanel
            instrument={instrument}
            onStart={() => navigation.navigate('Warmup')}
          />
        </View>
      </FadeIn>

      {attention || neglected ? (
        <FadeIn index={2}>
          <View style={styles.section}>
            <SectionHeader label="Also needs work" />
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

      <FadeIn index={3}>
        <View style={styles.section}>
          <AddPieceAction onPress={() => setAddSheetVisible(true)} />
        </View>
      </FadeIn>

      <AddPieceSheet
        visible={addSheetVisible}
        onClose={() => setAddSheetVisible(false)}
        onSelect={handleSelectOption}
      />
    </ScreenContainer>
  );
}

function AddPieceAction({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Add a new piece"
      accessibilityHint="Scan sheet music, import a score, or enter a piece manually"
      style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
    >
      {/* An outlined mark, not a filled one. This was a black square inside a
          white card — the same weight as the screen's one primary action, for
          the thing you do occasionally rather than the thing you came to do. */}
      <View style={styles.addMark}>
        <Plus
          size={ICON_SIZE.md}
          strokeWidth={ICON_STROKE_WIDTH}
          color={colors.textPrimary}
        />
      </View>
      <View style={styles.addBody}>
        <Text variant="body">Add a new piece</Text>
      </View>
      <ChevronRight
        size={ICON_SIZE.md}
        strokeWidth={ICON_STROKE_WIDTH}
        color={colors.textTertiary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pitch: {
    marginTop: spacing.lg,
  },
  // A quiet second route under the primary, not a second button: two
  // full-width buttons in a footer is two things asking to be pressed first.
  otherRoutes: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  pieceTitle: {
    marginTop: spacing.md,
  },
  pieceMeta: {
    marginTop: spacing.sm,
  },
  /**
   * Full bleed, out through the screen's own gutter.
   *
   * A crop of engraving inset behind a margin reads as a stock photograph of
   * sheet music; edge to edge it reads as the page itself.
   */
  banner: {
    marginTop: spacing.lg,
    marginHorizontal: -spacing.lg,
    height: BANNER_HEIGHT,
  },
  headline: {
    marginTop: spacing.lg,
  },
  lessonBody: {
    marginTop: spacing.sm,
  },
  lessonExercise: {
    marginTop: spacing.md,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  avatar: {
    margin: -AVATAR_INSET,
    padding: AVATAR_INSET,
    borderRadius: AVATAR_TARGET / 2,
  },
  pressed: {
    opacity: 0.7,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: CONTROL_HEIGHT,
  },
  addMark: {
    width: ICON_SIZE.md + spacing.sm,
    height: ICON_SIZE.md + spacing.sm,
    borderRadius: radii.sm,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBody: {
    flex: 1,
  },
});
