import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
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
import { SCREEN_GUTTER } from '../../components/primitives/ScreenContainer';
import { useInsights } from '../../data/hooks/useInsights';
import { useRecentTakes } from '../../data/hooks/useLatestTake';
import { useMe } from '../../data/hooks/useMe';
import { useCurrentPiece, useLibrary } from '../../data/hooks/usePieces';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { usePreferences } from '../../data/preferences';
import type { Piece } from '../../data/types';
import { describeLoadError } from '../../data/api/describeError';
import { getAnalysis } from '../../data/api/analyses';
import { ApiError } from '../../data/api/client';
import {
  forgetPendingAnalysis,
  usePendingAnalysis,
} from '../../data/practice/pendingAnalysis';
import { spacing } from '../../design';
import {
  formatLastPracticedShort,
  joinMetadata,
} from '../../lib/format';
import { getGreeting } from '../../lib/greeting';
import { formatTempo, formatVerdict } from '../../lib/tempo';
import { readTendency } from '../../lib/insights/tendency';
import { suggestionsFor } from '../../lib/today';
import type { TabScreenNavigation } from '../../navigation/types';
import { WarmupPanel } from './WarmupPanel';
import { PracticeHero } from './PracticeHero';
import { heroContentFor } from './heroContent';
import { TodayRow } from './TodayRow';
import { useAddPieceOption } from '../../navigation/useAddPieceOption';
import { loadStateFor } from '../../lib/loadState';

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
  const pendingAnalysis = usePendingAnalysis();
  const [pendingCheck, setPendingCheck] = useState<
    'checking' | 'working' | 'ready' | 'unavailable' | null
  >(null);

  /**
   * Ask once on arrival, and again only when the musician asks.
   *
   * The recording screen already polled continuously while it was open. After
   * a refresh this card is deliberately quieter: one request tells us whether
   * the durable row is ready, while a button makes a slow or offline result
   * recoverable without keeping a hidden tab polling forever.
   */
  // The id, not the record: it is the only field this uses, and it is what the
  // callback's identity should turn on. Naming the whole record would rebuild
  // the callback — and re-run the effect below it — every time the stored row
  // is re-read into a new object.
  const pendingAnalysisId = pendingAnalysis?.analysisId ?? null;

  const checkPendingAnalysis = useCallback(async () => {
    if (!pendingAnalysisId) {
      setPendingCheck(null);
      return;
    }
    setPendingCheck('checking');
    try {
      const analysis = await getAnalysis(pendingAnalysisId);
      setPendingCheck(
        analysis.status === 'done' ||
          analysis.status === 'failed' ||
          analysis.status === 'failed_recoverable'
          ? 'ready'
          : 'working',
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // It belongs to an old/deleted account or was removed with its piece.
        await forgetPendingAnalysis(pendingAnalysisId);
        setPendingCheck(null);
        return;
      }
      setPendingCheck('unavailable');
    }
  }, [pendingAnalysisId]);

  useEffect(() => {
    void checkPendingAnalysis();
  }, [checkPendingAnalysis]);

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
  const pendingPiece =
    pendingAnalysis && library.data
      ? library.data.find((item) => item.id === pendingAnalysis.scoreId) ?? null
      : null;

  function openPendingVerdict() {
    if (!pendingAnalysis) {
      return;
    }
    navigation.navigate('Verdict', { analysisId: pendingAnalysis.analysisId });
    // Dispatch first. If the app closes on the exact boundary, leaving the
    // hand-off behind is harmless and preferable to losing the result.
    void forgetPendingAnalysis(pendingAnalysis.analysisId);
    void recentTakes.refetch();
    void insights.refetch();
  }

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
  const handleSelectOption = useAddPieceOption(() =>
    setAddSheetVisible(false),
  );

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

  /*
    **The greeting and the avatar, and nothing else.**
    A bare "+" was put here for one commit, on the reasoning that a primary
    action belongs in the header. It looked wrong: two unrelated circles
    crowding the trailing corner, the smaller of which gave no clue what it
    added. Adding a piece is a labelled row further down — it always was — and
    it now carries the same material as the rest of the control layer.
  */
  const header = <PageHeader title={getGreeting()} action={avatar} />;

  /**
   * The hero, for whichever state this screen is in.
   *
   * **One composition, not two.** The empty account used to get a different
   * screen — an `EmptyState` with its own title, description and button —
   * while the populated one got a card. They are the same shape: a label, the
   * thing to do next, a sentence about it, one button. `heroContentFor` is
   * where the two differ, which is one tested function rather than two screens
   * that drift.
   *
   * A closure rather than a value, because `workingBpm` is not known until
   * past the early returns above and a hoisted element would have to invent
   * one for a piece that does not exist.
   */
  const renderHero = (
    forPiece: Piece | null,
    bpm: number,
    headline: string | null,
    { loading = false }: { loading?: boolean } = {},
  ) => (
    <PracticeHero
      content={
        loading
          ? null
          : heroContentFor({
              piece: forPiece,
              workingBpm: bpm,
              lastTakeHeadline: headline,
            })
      }
      greeting={getGreeting()}
      name={me.data?.displayName ?? null}
      onAction={() =>
        forPiece ? openPractice(forPiece) : setAddSheetVisible(true)
      }
      onAdd={() => setAddSheetVisible(true)}
    />
  );

  const load = loadStateFor({
    isError: currentPiece.isError,
    hasData: currentPiece.data !== undefined,
  });

  if (load === 'loading') {
    return (
      <ScreenContainer contentStyle={styles.bleed}>
        {renderHero(null, 0, null, { loading: true })}
      </ScreenContainer>
    );
  }

  if (load === 'unavailable') {
    return (
      <ScreenContainer onRefresh={refresh} contentStyle={styles.page}>
        {header}
        <EmptyState
          title="Couldn't load your pieces"
          description={describeLoadError(currentPiece.error)}
          // **A dead end needs the action it names.** Without this the screen
          // says the pieces could not be loaded and offers nothing to do about
          // it — pull-to-refresh is not discoverable and is not available at
          // all on the web build, which is where most of this is used.
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
    return (
      <ScreenContainer onRefresh={refresh} contentStyle={styles.bleed}>
        {/*
          **The same hero the populated screen gets.** This used to be a
          different screen — an `EmptyState` with its own title, description
          and button, plus a comment explaining why it could not be centred
          any more. It is the same four things in the same order, so it is now
          the same component and `heroContentFor` decides what they say.
        */}
        {renderHero(null, 0, null)}
        <View style={styles.belowHero}>
        {/*
          **The same warmup block the populated screen renders**, deliberately
          not a variant of it: it depends on nothing but the instrument, so a
          new account can play something in its first minute instead of being
          told there is nothing. It was only ever absent here because it sits
          below this early return.
        */}
        <View style={[styles.section, styles.emptyWarmup]}>
          <SectionHeader label="Warmup" />
          {/*
            **On the page background, not in a card — and that is hierarchy,
            not tidiness.** Carded, it was the heaviest thing on the screen: a
            bordered block wrapping real engraved notation beats unenclosed
            text and a button every time, so the three-foot test read greeting,
            warmup, add-a-piece — the opposite of what this screen is for. It
            is also the only card that would be on the screen, which is exactly
            the habit §3 law 3 names. On the populated Today it is one of a
            column of cards and recedes by position instead; here position
            cannot do that work, so the panel goes back to the background
            `WarmupPanel`'s own docstring says it was designed for.
          */}
          <WarmupPanel
            instrument={instrument}
            onStart={() => navigation.navigate('Warmup')}
          />
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

  const workingBpm = practiceTempo.for(piece.id, piece.markedBpm);
  const hasCurrentTake = take?.pieceId === piece.id;
  const hasNotation = (piece.score?.measures.length ?? 0) > 0;
  const readingNotation =
    piece.transcriptionStatus === 'queued' ||
    piece.transcriptionStatus === 'reading';
  const summaryDetail = summary
    ? `Across ${summary.sessions === 1 ? '1 session' : `${summary.sessions} sessions`} in the last ${summary.windowDays} days`
    : '';

  return (
    <ScreenContainer onRefresh={refresh} contentStyle={styles.bleed}>
      {renderHero(
        piece,
        workingBpm,
        // Only when it is genuinely this piece's take. Against the API it
        // always is; a fixture or a deleted score could disagree, and a
        // verdict about a different piece under this title would be a lie.
        hasCurrentTake && take ? take.headline : null,
      )}

      <View style={styles.belowHero}>
      {pendingAnalysis && pendingCheck ? (
        <View style={styles.pendingTake}>
          <Card>
            <Text variant="sectionLabel" color="textSecondary">
              LAST RECORDING
            </Text>
            <Text variant="pieceTitle" style={styles.pendingTakeTitle}>
              {pendingCheck === 'ready'
                ? 'Your result is ready'
                : pendingCheck === 'unavailable'
                  ? "We couldn't check your result"
                  : 'Finishing your last take'}
            </Text>
            <Text variant="body" color="textSecondary" style={styles.pendingTakeBody}>
              {pendingCheck === 'ready'
                ? `Open the feedback${pendingPiece ? ` for ${pendingPiece.title}` : ''}.`
                : pendingCheck === 'unavailable'
                  ? 'Your recording was accepted and is still safe. Check again when your connection is steadier.'
                  : `InTempo is still listening${pendingPiece ? ` to ${pendingPiece.title}` : ''}. You can leave this screen and come back.`}
            </Text>
            <SecondaryButton
              label={
                pendingCheck === 'ready'
                  ? 'View result'
                  : pendingCheck === 'checking'
                    ? 'Checking…'
                    : 'Check again'
              }
              onPress={
                pendingCheck === 'ready'
                  ? openPendingVerdict
                  : () => void checkPendingAnalysis()
              }
              disabled={pendingCheck === 'checking'}
              style={styles.pendingTakeAction}
            />
          </Card>
        </View>
      ) : null}

      <View style={[styles.dashboard, isWide && styles.dashboardWide]}>
        <View style={styles.primaryColumn}>
          {/*
            **The card and the add-a-piece row are gone: the hero is both.**
            The card said the piece, its tempo and how the last take went, and
            offered one button — which is exactly what is now written across
            the photograph above, at a size that can be read from a stand.
            Repeating it here would be the same content twice on one screen,
            the second time smaller.

            Adding a piece is the "+" in the hero's corner. A labelled row was
            the right answer while the header held an avatar it would have
            crowded; the avatar is a tab now.
          */}
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
                        // One recording, so `formatVerdict` — the tendency
                        // wording is a claim about a habit and its own comment
                        // says a single take cannot see one. This rendered as
                        // "Today · 96 BPM · You tend to rush".
                        formatVerdict(recentTake.verdict),
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
                  {readingNotation
                    ? 'Reading your sheet music'
                    : !hasNotation
                      ? 'Add the music first'
                    : hasCurrentTake
                      ? 'Make the next take comparable'
                      : 'Set your first benchmark'}
                </Text>
                <Text
                  variant="body"
                  color="textSecondary"
                  style={styles.focusText}
                >
                  {readingNotation
                    ? 'InTempo is turning the pages into notation. Practice recording will unlock when that reading finishes.'
                    : !hasNotation
                      ? `Attach the sheet music for ${piece.title} so InTempo can follow notes, rests, and re-entries before recording.`
                    : hasCurrentTake
                      ? `Stay at ${formatTempo(workingBpm, piece.score?.tempo_beat_unit)} and record one more honest run. Comparing two takes shows whether the change held.`
                      : `Record one honest run of ${piece.title}. InTempo will map where your tempo holds and where it drifts.`}
                </Text>
                <SecondaryButton
                  label={
                    readingNotation
                      ? 'View reading progress'
                      : !hasNotation
                        ? 'Add sheet music'
                      : hasCurrentTake
                        ? 'Record another take'
                        : 'Record first take'
                  }
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
                  // **The same reading Insights shows, from the same module.**
                  // `formatTendency(summary.verdict)` is the aggregate's
                  // direction and nothing else, so a musician whose practice
                  // wanders read "Your tempo wanders" on one tab and "You tend
                  // to rush" on the next, about the same thirty days.
                  title={readTendency(summary).title}
                  detail={summaryDetail}
                  onPress={() => navigation.navigate('Insights')}
                  last
                />
              </View>
            </FadeIn>
          ) : null}
        </View>
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

const styles = StyleSheet.create({
  /**
   * The hero is full-bleed, so the screen's own gutter has to come off.
   *
   * `contentStyle` is merged after `ScreenContainer`'s own `content`, which is
   * where `SCREEN_GUTTER` lives — so this cancels it for the scroll container
   * and `belowHero` puts it back for everything under the photograph.
   */
  bleed: {
    paddingHorizontal: 0,
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
  },
  /** The gutter, restored for the ordinary page below the hero. */
  belowHero: { paddingHorizontal: SCREEN_GUTTER },
  page: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
  },
  pendingTake: {
    marginBottom: spacing['2xl'],
  },
  pendingTakeTitle: {
    marginTop: spacing.xs,
  },
  pendingTakeBody: {
    marginTop: spacing.sm,
  },
  pendingTakeAction: {
    marginTop: spacing.lg,
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
  emptyBody: {
    // Needs `flexGrow` on `ScreenContainer`'s content container to have any
    // effect — see the note there. Content taller than the viewport still
    // scrolls; this only decides where shorter content sits.
    flex: 1,
    justifyContent: 'center',
  },
  emptyWarmup: {
    // **Zero, and it is not a missing value.** `EmptyState` already ends in
    // 32pt of its own padding, so the ordinary 24pt section gap stacked on top
    // of it put 56pt between the button and this label — more than double any
    // other gap on Today, which is what left the empty screen looking like it
    // had stopped early. The 32pt that remains is still a step looser than a
    // normal section break, which is right: these are two different kinds of
    // block, not two sections of one flow.
    marginTop: 0,
  },
  section: {
    // One step tighter than it was. At 32pt the blocks read as separate pages
    // of a document rather than as parts of one screen — which is most of what
    // made this feel like a web page.
    marginTop: spacing['2xl'],
  },
});
