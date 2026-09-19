import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { AddPieceSheet } from '../../components/pieces/AddPieceSheet';
import {
  EmptyState,
  PageHeader,
  ScreenContainer,
} from '../../components/primitives';
import { useRecentTakes } from '../../data/hooks/useLatestTake';
import { useMe } from '../../data/hooks/useMe';
import { useCurrentPiece, useLibrary } from '../../data/hooks/usePieces';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import type { Piece } from '../../data/types';
import { describeLoadError } from '../../data/describeLoadError';
import {
  forgetPendingAnalysis,
  usePendingAnalysis,
} from '../../data/practice/pendingAnalysis';
import { readPendingAnalysisStatus } from '../../data/practice/pendingAnalysisStatus';
import { getGreeting } from '../../lib/greeting';
import type { TabScreenNavigation } from '../../navigation/types';
import { PracticeHero, useHeroHeight } from './PracticeHero';
import { heroContentFor, pendingLineFor } from './heroContent';
import { useAddPieceOption } from '../../navigation/useAddPieceOption';
import { loadStateFor } from '../../lib/loadState';

/**
 * Today is one screen, and it does not scroll.
 *
 * **It was a dashboard, and the dashboard is gone.** Under the photograph sat
 * a warmup panel, a "Practice focus" card that restated the hero in smaller
 * type, a "Repertoire queue" of two rows, a list of recent takes and a
 * one-line practice snapshot — five blocks, every one of which was either
 * reachable in a tab of its own or already written across the hero above it.
 * The owner asked for the scrolling to stop and named three of them; stopping
 * it means the other two go too, because half a screen of content below a
 * full-viewport hero is exactly the scroll that was being complained about.
 *
 * Nothing has been lost that was only here. Recent takes and the thirty-day
 * reading are the Insights tab, which is where they were duplicated *from*;
 * the repertoire queue was a ranking over the Library; the warmup is a row in
 * Profile's Practice section now.
 *
 * What is left is what the screen is for: which piece to play, how it went
 * last time, one button that starts a take, and a way to add a piece. One
 * dominant focal point (§3 law 4), and the thumb zone belongs to the action
 * rather than to a list (§3 law 7).
 *
 * **There is no pull-to-refresh**, because there is nothing to pull. React
 * Query refetches on focus, and the one thing a musician might want to ask
 * again for — the take this device handed over — is a line under the button
 * that asks when pressed.
 */
export function TodayScreen() {
  const navigation = useNavigation<TabScreenNavigation<'Today'>>();
  // The whole screen is the dark ground, and `ScreenContainer` needs that in
  // points to tell the floating chrome which material to wear.
  const heroHeight = useHeroHeight();
  const currentPiece = useCurrentPiece();
  // Only to name the piece a pending take belongs to. Shared cache with the
  // Library tab, so this is a read rather than a second fetch.
  const library = useLibrary();
  // One, because one is all the hero says anything about.
  const recentTakes = useRecentTakes(1);
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
   * a refresh this hand-off is deliberately quieter: one request tells us
   * whether the durable row is ready, while the line under the hero's button
   * makes a slow or offline result recoverable without keeping a hidden tab
   * polling forever.
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
      const status = await readPendingAnalysisStatus(pendingAnalysisId);
      if (status === 'missing') {
        // It belongs to an old/deleted account or was removed with its piece.
        await forgetPendingAnalysis(pendingAnalysisId);
        setPendingCheck(null);
        return;
      }
      setPendingCheck(status);
    } catch {
      setPendingCheck('unavailable');
    }
  }, [pendingAnalysisId]);

  useEffect(() => {
    void checkPendingAnalysis();
  }, [checkPendingAnalysis]);

  // The working tempo is local and per piece, so this subscribes rather than
  // reading once — changing it on the Record screen has to show here.
  usePracticeTempos();

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

  const take = recentTakes.data?.[0] ?? null;

  const load = loadStateFor({
    isError: currentPiece.isError,
    hasData: currentPiece.data !== undefined,
  });

  if (load === 'unavailable') {
    return (
      // The one composition on this tab that is not the photograph: there is
      // no piece to write across it and no action to offer but the retry.
      <ScreenContainer scrollable={false}>
        <PageHeader title={getGreeting()} />
        <EmptyState
          title="Couldn't load your pieces"
          description={describeLoadError(currentPiece.error)}
          // **A dead end needs the action it names.** Without this the screen
          // says the pieces could not be loaded and offers nothing to do about
          // it — pull-to-refresh is not discoverable, is gone from this tab,
          // and was never available at all on the web build.
          actionLabel={currentPiece.isFetching ? 'Trying…' : 'Try again'}
          onActionPress={() => void currentPiece.refetch()}
          actionDisabled={currentPiece.isFetching}
        />
      </ScreenContainer>
    );
  }

  const workingBpm = piece ? practiceTempo.for(piece.id, piece.markedBpm) : 0;
  // Only when it is genuinely this piece's take. Against the API it always is;
  // a fixture or a deleted score could disagree, and a verdict about a
  // different piece under this title would be a lie.
  const headline = piece && take?.pieceId === piece.id ? take.headline : null;

  return (
    /*
      `scrollable={false}` is the whole point of this screen, and `bleed` is
      what lets the photograph reach both edges — including the web build's
      reserved scrollbar gutter, which was a 10pt stripe of page background
      down the right of it.
    */
    <ScreenContainer
      scrollable={false}
      bleed
      darkGround={heroHeight}
      contentStyle={styles.page}
    >
      <PracticeHero
        /*
          Null while the piece is still coming: the same photograph, the same
          wash, nothing written on it yet — so the screen does not jump when
          the answer arrives. `heroContentFor` covers the account with no
          pieces at all, which is a real state of this screen rather than a
          fallback.
        */
        content={
          load === 'loading'
            ? null
            : heroContentFor({
                piece,
                workingBpm,
                lastTakeHeadline: headline,
              })
        }
        greeting={getGreeting()}
        name={me.data?.displayName ?? null}
        onAction={() => (piece ? openPractice(piece) : setAddSheetVisible(true))}
        onAdd={() => setAddSheetVisible(true)}
        pending={
          pendingAnalysis && pendingCheck
            ? pendingLineFor(pendingCheck, pendingPiece?.title ?? null)
            : null
        }
        onPending={
          pendingCheck === 'ready'
            ? openPendingVerdict
            : pendingCheck === 'checking'
              ? undefined
              : () => void checkPendingAnalysis()
        }
      />

      <AddPieceSheet
        visible={addSheetVisible}
        onClose={() => setAddSheetVisible(false)}
        onSelect={handleSelectOption}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  page: {
    /*
      **No bottom inset.** `bleed` drops the horizontal gutter; the inset is
      the other half, and `ScreenContainer` adds it so ordinary content clears
      the floating tab bar. This screen's only child is a photograph that
      reaches every edge and pays the bar its own clearance from the inside
      (`PracticeHero`), so leaving it on drew a band of page background under
      the hero.
    */
    paddingBottom: 0,
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
  },
});
