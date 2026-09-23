import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Camera, Images } from '../../components/icons';
import { useGoBack } from '../../navigation/useGoBack';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { describePagePosition, pageAtOffset } from '../../lib/score/pageIndex';
import { Stave } from '../../components/notation/Stave';
import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { ListenButton } from '../../components/score/ListenButton';
import { PlaybackSettings } from '../../components/score/PlaybackSettings';
import { TranscribingPanel } from '../../components/score/TranscribingPanel';
import {
  EmptyState,
  LoadingState,
  BackLink,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  SegmentedControl,
  Text,
  ToggleRow,
} from '../../components/primitives';
import { BottomSheet } from '../../components/overlays/BottomSheet';
import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import { PrimaryButton } from '../../components/primitives';
import {
  useAcceptTranscription,
  usePiece,
  useRetranscribe,
  useSetClef,
} from '../../data/hooks/usePieces';
import {
  BORDER_WIDTH,
  colors,
  MIN_TOUCH_TARGET,
  pressedOpacity,
  radii,
  spacing,
} from '../../design';
import { SCREEN_GUTTER } from '../../components/primitives/ScreenContainer';
import { ROW_PADDING_VERTICAL } from '../../components/rowMetrics';
import {
  describeOmissions,
  describeUndrawnScore,
  staveScoreFor,
} from '../../lib/notation/fromScore';
import { shortenLongRests, skippableBars } from '../../lib/notation/longRests';
import { CLEF_LABELS } from '../../lib/notation/clefLabels';
import {
  scheduleScore,
  soundingMeasureAt,
  startAtMeasure,
  startableMeasures,
} from '../../lib/score';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { bpmForMarking } from '../../lib/tempoMarking';
import {
  describeConfidence,
  describeProblemMeasures,
  readingNotesFor,
} from '../../lib/notation/reading';
import type { Clef } from '../../data/types';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import {
  keySignatureFor,
  timeSignatureDigits,
} from '../../lib/notation/keySignature';
import { loadStateFor } from '../../lib/loadState';
import { barCells, barGridSummary } from '../../lib/notation/barGrid';
import { proposalsFor, proposalsSummary } from '../../lib/notation/proposals';
import { usePreferences } from '../../data/preferences';
import { TrailingChevron } from '../../components/primitives/TrailingChevron';

/** Read from a stand, not glanced at — the same size the warmup page uses. */
const STAVE_SCALE = 1.25;

/**
 * How a clef is named in prose.
 *
 * Spelled out rather than drawn: `engrave.ts` deliberately draws no clef, and a
 * hand-approximated treble clef would be the first thing a musician noticed.
 */
/** The four, in the order a string player meets them. */
const CLEF_ORDER: Clef[] = ['treble', 'bass', 'alto', 'tenor'];

/**
 * Where noteheads go while nothing has said which clef the part is in.
 *
 * `ScoreJson.clef` is nullable on purpose — a score exists before anything has
 * read it, an imported MusicXML file need not state one, and `PATCH` accepts an
 * explicit null as a real answer. This screen used to write `?? 'treble'` in
 * two places, which did two different wrong things at once: it **captioned**
 * the part "Treble clef", indistinguishably from a clef that had actually been
 * read, and it handed the same guess to the engraver, so every note of an
 * unlabelled bass part was placed a seventh off its real pitch.
 *
 * A stave has to put its noteheads somewhere, so the guess cannot be avoided —
 * but it can be *declared*. The caption says the clef was not read, and the
 * caveat below the stave says the notes are placed as though in treble and
 * offers to be told better. Naming it here rather than inlining `'treble'`
 * again is the point: there is exactly one place left that assumes, and it says
 * out loud that it is assuming.
 */
const UNREAD_CLEF_PLACEMENT: Clef = 'treble';

/** Tall enough that a page of sheet music is legible rather than indicated. */
const PAGE_HEIGHT = 420;

/**
 * A page's height as a share of its width, for the Original view.
 *
 * Derived from the width the viewport actually measured rather than fixed,
 * because this screen is a phone column at 390 and a 1240px container at the
 * desktop breakpoint. Portrait A4 is 1.414; a hair under, because a photograph
 * of a page is nearly always cropped tighter than the paper.
 */
const PAGE_ASPECT = 1.35;


/**
 * The same page while it is still being read.
 *
 * Shorter, because the screen is about the reading at that moment and a
 * full-height photograph would be the first thing the eye lands on — two
 * focal points, and the wrong one dominant (§3 law 4). It stays on screen
 * rather than being removed because confirming the right page went up is a
 * real thing to want while waiting.
 */
const PAGE_HEIGHT_WHILE_READING = 240;

/*
 * There was a `FALLBACK_LISTEN_BPM = 72` here, and it is worth saying where it
 * went. It was a study tempo — slow enough that a wrong bar is audible as a
 * wrong bar rather than a blur — and it was the *only* tempo this screen had:
 * a piece marked at 152 could be heard at 152 and at nothing else, because
 * nothing on the screen could change it.
 *
 * Playback now runs at the piece's working tempo, which the musician can move
 * (`PlaybackSettings`), so the argument for a slow default is answered by the
 * control rather than by overriding the page. Where the page named no tempo
 * and carries no marking, `practiceTempo` falls back to 80.
 */

type ScoreView = 'notation' | 'original';

/**
 * A saved piece's own score.
 *
 * **This screen exists because the two rows that led here led somewhere else.**
 * "Digital score" and "Original pages" on the piece screen both pushed routes
 * that read the in-memory *scan session* — so they showed whatever was last
 * photographed, under the name of the piece you had opened, and with no scan in
 * flight they showed "Nothing to review". Worse, the captured-pages screen has
 * a live "Continue" footer, so from any piece in the library you could walk
 * forward into the transcription flow and land on a hardcoded fixture.
 *
 * Both rows now come here, with a piece id, and this reads that piece.
 *
 * The engraving is drawn from the piece's real `score_json`, and it does not
 * round: see `lib/notation/fromScore.ts` for why a stave that misreports
 * rhythm is the one picture this app must never draw, and what it does
 * instead.
 */
export function PieceScoreScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'PieceScore'>>();
  const goBack = useGoBack({
    route: 'PieceDetail',
    params: { pieceId: params.pieceId },
  });
  const { data: piece, isError } = usePiece(params.pieceId);
  const { instrument } = usePreferences();
  const load = loadStateFor({ isError, hasData: piece !== undefined });

  const accept = useAcceptTranscription(params.pieceId);
  const reread = useRetranscribe();
  const setClef = useSetClef(params.pieceId);
  const [confirmingAccept, setConfirmingAccept] = useState(false);
  const [pickingMeasure, setPickingMeasure] = useState(false);
  const [pickingClef, setPickingClef] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const [view, setView] = useState<ScoreView>(params.view ?? 'notation');
  // The engraver needs a pixel width to wrap against, and only layout knows it.
  const [width, setWidth] = useState<number | null>(null);

  /**
   * Whether the long rests are skipped, for listening and for the stave.
   *
   * Screen-local rather than remembered per piece. It is a way of *inspecting*
   * a reading — hearing whether OCR got a passage right — and the honest
   * default for that is the whole page. The record screen has its own,
   * separate, because there it changes what is analysed.
   */
  const [skipRests, setSkipRests] = useState(false);
  /**
   * Which photographed page is on screen, and how wide one is.
   *
   * **Above every early return, with the rest of the hooks.** Declared beside
   * the code that uses them — after the `isPending` and `isError` branches —
   * they changed the hook count between renders and React tore the screen down
   * with error #310. The error boundary caught it, which is the only reason it
   * showed as "Something broke" rather than a blank page.
   *
   * The width is measured rather than assumed: this screen is a phone column at
   * 390 and a 1240px container at the desktop breakpoint, and a page has to be
   * exactly one viewport for `pagingEnabled` to land on boundaries.
   */
  const [pageWidth, setPageWidth] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const skippable = useMemo(() => skippableBars(piece?.score), [piece?.score]);
  const heard = useMemo(() => {
    if (!piece?.score) {
      return null;
    }
    return skipRests ? shortenLongRests(piece.score).score : piece.score;
  }, [piece?.score, skipRests]);

  const stave = useMemo(() => (heard ? staveScoreFor(heard) : null), [heard]);

  /**
   * Which bar the playback is in, or null when nothing is sounding.
   *
   * Built from the same schedule the player is running, so the stave and the
   * speaker cannot disagree about where they are. Rebuilding it rather than
   * threading it out of `ListenButton` keeps the button's job to one thing —
   * and it is the same pure function with the same inputs, so it is the same
   * schedule.
   */
  const [elapsedS, setElapsedS] = useState<number | null>(null);
  /**
   * The tempo playback runs at, remembered per piece.
   *
   * The same store the Record screen reads, so a passage slowed down to hear
   * it is the tempo the take then opens at — which is what a musician working
   * a hard bar means by slowing it down. It used to be `markedBpm` with no way
   * to change it, so a piece marked at 152 could only ever be heard at 152.
   */
  usePracticeTempos();
  const listenBpm = practiceTempo.for(
    params.pieceId,
    piece?.markedBpm ?? bpmForMarking(piece?.score?.tempo_marking),
  );
  /** Which bar Listen enters on. Reset when the piece changes underneath it. */
  const [fromMeasure, setFromMeasure] = useState<number | null>(null);
  const whole = useMemo(
    () => (heard ? scheduleScore(heard, listenBpm) : null),
    [heard, listenBpm],
  );
  const startable = useMemo(() => (whole ? startableMeasures(whole) : []), [whole]);
  /** The chosen bar, or the first one that sounds — never a bar that does not. */
  const listenFrom =
    fromMeasure !== null && startable.includes(fromMeasure)
      ? fromMeasure
      : (startable[0] ?? 1);
  // The schedule the *button* is running, so the lit bar and the speaker
  // cannot disagree about where they are.
  const playback = useMemo(
    () => (whole ? startAtMeasure(whole, listenFrom) : null),
    [whole, listenFrom],
  );
  const soundingMeasure = useMemo(
    () => soundingMeasureAt(playback, elapsedS),
    [elapsedS, playback],
  );

  const reading = useMemo(
    () => (piece?.score ? readingNotesFor(piece.score, piece.concerns) : null),
    [piece?.score, piece?.concerns],
  );

  function measure(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  if (load === 'loading') {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (load === 'unavailable' || !piece) {
    return (
      <ScreenContainer>
        <EmptyState
          fill
          title="Couldn't open this score"
          description="The piece may have been removed from your library."
          actionLabel="Back"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  const hasNotation = (stave?.items.length ?? 0) > 0;
  const hasPages = piece.thumbnail !== null;
  /**
   * One page-shaped box for every page of this scan.
   *
   * **Fixed rather than measured from each image, and that is a retreat worth
   * recording.** Sizing the box to the photograph's own aspect means nothing is
   * ever letterboxed — and on the web build the scroll view and its pages then
   * disagreed about the result: measured, a 122px page inside a 398px scroller,
   * because react-native-web does not size a horizontal `ScrollView` from its
   * content the way the native one does.
   *
   * Chasing that further was optimising for a fixture. `assets/fixtures` holds
   * 1200x124 crops of a single system, and no photograph of a page looks like
   * that: a portrait page fills this box, and the crops letterbox, which is an
   * honest picture of what they are. One number, and nothing left to disagree.
   */
  const pageBox =
    pageWidth > 0
      ? { width: pageWidth, height: Math.round(pageWidth * PAGE_ASPECT) }
      : null;

  // Still being read. Distinguished from "has no notes" by the status and only
  // by the status: an empty transcription looks identical either way, and one
  // of the two is worth waiting on.
  const stillReading =
    piece.transcriptionStatus === 'queued' || piece.transcriptionStatus === 'reading';

  if (stillReading) {
    return (
      <ScreenContainer>
        <PageHeader
          title={piece.title}
          titleSize="hero"
          onBack={goBack}
          backLabel="Back to piece"
        />
        <TranscribingPanel piece={piece} />
        {hasPages ? (
          <ScoreThumbnail source={piece.thumbnail} style={styles.pageWhileReading} />
        ) : null}
      </ScreenContainer>
    );
  }

  if (piece.transcriptionStatus === 'failed') {
    return (
      <ScreenContainer>
        <PageHeader
          title={piece.title}
          titleSize="hero"
          onBack={goBack}
          backLabel="Back to piece"
        />
        {/*
          The backend's sentence, not a generic one. It knows which half failed
          — a page that could not be fetched and a page that could not be read
          need different things from the musician, and telling someone to
          retake a photograph that was never downloaded wastes their time.
        */}
        {/*
          Reading again comes first, and photographing again second.

          The photograph is still in storage and is usually fine — a rate
          limit, a truncated response, a model having a bad minute. Leading
          with "photograph it again" asked the musician to re-upload several
          megabytes to solve a problem the megabytes never caused.
        */}
        <EmptyState
          title="Couldn't read this page"
          description={
            piece.transcriptionError ??
            'Something went wrong.'
          }
          actionLabel={reread.isPending ? 'Reading again…' : 'Try again'}
          // The label said it was working; the button carried on accepting
          // taps, and each one started another reading of the same page. The
          // server refuses the second now, but a musician should not have to
          // meet that refusal to learn the first tap landed.
          actionDisabled={reread.isPending}
          onActionPress={() => {
            setAcceptError(null);
            reread.mutate(params.pieceId, {
              onError: (cause) =>
                setAcceptError(
                  cause instanceof Error
                    ? cause.message
                    : 'Couldn’t start. Try again.',
                ),
            });
          }}
        />
        {/*
          This branch returns early, and `acceptError` was only rendered far
          below in the branch that has notation — so a "Try reading it again"
          that failed wrote its reason into state that this screen never
          showed. What a musician saw was the button say "Reading again…",
          go back to "Try reading it again", and nothing else: the same screen,
          no error, no progress, and no way to tell a refused request from one
          that had quietly worked.
        */}
        {acceptError ? (
          <Text variant="metadataSmall" color="textSecondary" style={styles.caveat}>
            {acceptError}
          </Text>
        ) : null}
        {/*
          Both alternatives keep this piece's id. This used to open a fresh
          scanner with no attachment target, so a successful retake created a
          duplicate piece and left this failed one exactly as it was. The
          server now replaces failed, note-less pages in this row and refuses
          to erase a score that still has usable measures.
        */}
        <SecondaryButton
          label="Retake photos"
          icon={Camera}
          onPress={() =>
            navigation.navigate('Scanner', { attachToPieceId: piece.id })
          }
          disabled={reread.isPending}
          style={styles.recoveryAction}
        />
        <SecondaryButton
          label="Choose other photos"
          icon={Images}
          onPress={() =>
            navigation.navigate('AddPiece', {
              option: 'import',
              attachToPieceId: piece.id,
            })
          }
          disabled={reread.isPending}
          style={styles.recoverySecondary}
        />
        {/*
          **It said "you can practise it with the metronome", and you cannot.**
          `PieceDetailScreen` gates its practice button on `hasNotation`, and
          there is no other route to the metronome — so a musician who read
          that sentence and went looking found a screen offering to photograph
          the page instead. That screen is right: recording without notation
          produces a take nothing can align, and it says so plainly ("InTempo
          needs the written notes and rests to follow your playing"). The
          promise was the only thing out of step.

          What is still true, and worth saying, is that the piece is not lost.
        */}
        {hasPages ? (
          <ScoreThumbnail source={piece.thumbnail} style={styles.pageWhileReading} />
        ) : null}
      </ScreenContainer>
    );
  }

  // Both halves exist only when the piece was photographed *and* transcribed.
  // A piece entered by hand has neither, and a toggle between two absences
  // would be the emptiest control in the app (§3 law 10).
  // Every bar as a cell, for the picker. Cheap and pure — see `barGrid.ts`.
  const cells = barCells(piece.score, reading?.problemMeasures ?? []);
  // What the app is willing to say is wrong with the reading, which is the
  // half the beat check cannot reach. The instrument is this device's, because
  // a score does not carry one — see `proposals.ts`.
  const proposals = proposalsFor(piece.score, instrument);
  const showToggle = hasNotation && hasPages;
  const showing: ScoreView = showToggle ? view : hasNotation ? 'notation' : 'original';
  // The listening rows are drawn and nothing is written between them and the
  // action rows, so the action rows continue their list. A note about the
  // reading in between (what was left out, how sure the reader was, an unread
  // clef) is a break, and the actions start a list of their own after it.
  const listening = showing === 'notation' && hasNotation && stave !== null;
  const noteBetween =
    listening &&
    Boolean(
      describeOmissions(stave) ||
        (reading && !piece.transcriptionAccepted && describeConfidence(reading.confidence)) ||
        reading?.notes ||
        !piece.score?.clef,
    );
  const continuesList = listening && !noteBetween;

  return (
    <ScreenContainer key={showing}>
      {/*
        The redesign's head (`redesign/PieceScore.dc.html`), the same as the
        piece's own: a way back in words, then the title. The composer is on
        the piece, one step back.
      */}
      <View style={styles.head}>
        <BackLink label="Back to the piece" onPress={goBack} />
        <Text variant="heroTitle" accessibilityRole="header" style={styles.title}>
          {piece.title}
        </Text>
      </View>

      {showToggle ? (
        <SegmentedControl
          label="Score view"
          options={[
            { value: 'notation' as const, label: 'Notation' },
            { value: 'original' as const, label: 'Original' },
          ]}
          value={view}
          onChange={setView}
        />
      ) : null}

      {/* Put actionable reading concerns before playback and practice. A bad
          bar duration can shift the timing of every bar that follows it. */}
      {showing === 'notation' && hasNotation &&
      (reading?.problemMeasures.length || proposals.length) ? (
        <View style={styles.reviewFirst}>
          <Text variant="sectionLabel" color="textPrimary">
            Before you practice
          </Text>
          {reading && reading.problemMeasures.length > 0 ? (
            <Pressable
              onPress={() =>
                navigation.navigate('MeasureEdit', {
                  pieceId: piece.id,
                  measureNumber: reading.problemMeasures[0],
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Fix bar ${reading.problemMeasures[0]}`}
              style={({ pressed }) => [styles.fixRow, pressed && styles.pressed]}
            >
              <Text variant="metadataSmall" color="textSecondary">
                {describeProblemMeasures(reading.problemMeasures, {
                  canCheck: hasPages,
                  concerns: reading.concerns,
                })}
              </Text>
              <Text variant="metadataSmall" color="accentText" style={styles.fixCue}>
                Fix bar {reading.problemMeasures[0]}
              </Text>
            </Pressable>
          ) : null}
          {proposals.length > 0 ? (
            <Pressable
              onPress={() => navigation.navigate('ProofRead', { pieceId: piece.id })}
              accessibilityRole="button"
              accessibilityLabel="Check the reading"
              style={({ pressed }) => [styles.fixRow, pressed && styles.pressed]}
            >
              <Text variant="metadataSmall" color="textSecondary">
                {proposalsSummary(proposals.length)}
              </Text>
              <Text variant="metadataSmall" color="accentText" style={styles.fixCue}>
                Check
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!hasNotation && !hasPages ? (
        <EmptyState
          fill
          title="No score to show"
          description="This piece was typed in by hand, so there are no notes read from a page and no photograph. Photograph the music to get both."
        />
      ) : null}

      {showing === 'notation' && hasNotation && stave ? (
        <View style={styles.plate}>
          {/* **Measured inside the paper's margins, not outside them.**
              `onLayout` reports a view's border box, so measuring the padded
              page handed the stave the paper's full width and every system ran
              off the right edge. This inner view has no padding of its own, so
              its width is the width the music may use. */}
          <View onLayout={measure}>
          {width === null ? null : (
            <Stave
              notes={stave.items}
              highlightMeasure={soundingMeasure}
              clef={piece.score?.clef ?? UNREAD_CLEF_PLACEMENT}
              maxWidth={width}
              // **Both, and they do different jobs.** `maxWidth` breaks the
              // music into systems, but it can only break at a barline — so a
              // bar denser than one line can hold stays over-wide however many
              // systems it is given. `fitWidth` then shrinks the whole
              // engraving until it fits, which is the only remedy left.
              //
              // Without it the layout squeezed the columns instead: the
              // Kreutzer study's opening bar of sixteen sixteenths came out at
              // 0.95 staff spaces a column, narrower than the 1.18 a notehead
              // occupies, so the noteheads printed into each other.
              fitWidth={width}
              scale={STAVE_SCALE}
              justify
              beatQuarters={stave.beatQuarters}
              closesWithRepeat={stave.closesWithRepeat}
              endings={stave.endings}
              // **The page's own furniture.** `key_signature` has been read
              // off the page since Batch 2 and shown only as text, so a piece
              // in E major was engraved with four accidentals missing from
              // every system and an inline sharp on every note that needed
              // one. That is a list of pitches, not a line of music.
              head={{
                clef: piece.score?.clef ?? null,
                key: keySignatureFor(
                  piece.score?.key_signature,
                  piece.score?.clef ?? UNREAD_CLEF_PLACEMENT,
                ),
                time: timeSignatureDigits(piece.score?.time_signature),
              }}
              // A letter under every note is a study-book aid. On repertoire it
              // reads as a crib, so the clef is stated as metadata above
              // instead — which is where a clef belongs on a screen for reading
              // music, and is the obligation `showNoteNames={false}` carries.
              showNoteNames={false}
              /*
                **The engraving is the bar picker.** Correcting a bar meant
                opening a sheet and finding its number in a list of seventy —
                on a screen already showing every bar, drawn, in order. A
                musician proofreading a page looks at the bar that is wrong;
                the way to act on it should be to touch it.

                `open`, not `select`: each bar opens an editor of its own, so
                it is a button with nothing checked rather than a radio. The
                record screen's stave is the other case, and the two are
                announced differently on purpose — see `measurePressRole`.
              */
              onMeasurePress={(measureNumber) =>
                navigation.navigate('MeasureEdit', {
                  pieceId: piece.id,
                  measureNumber,
                })
              }
              measurePressRole="open"
              measurePressLabel={(measureNumber) => `Correct bar ${measureNumber}`}
            />
          )}
          </View>
        </View>
      ) : null}

      {/*
        **The affordance said out loud**, because nothing on a stave depicts a
        tap. A drawn control that does nothing is worse than none at all (§3),
        and the inverse is nearly as bad: a gesture that works and is invisible
        is a gesture nobody uses. Left-aligned like every other line on the
        screen — it was centred, which is the inconsistency §3 law 5 is about.

        It is the only thing under the page now. A row of facts used to sit
        here — length, clef, metre, the marked tempo — and was removed on
        2026-09-16: the piece detail screen already states the length and the
        tempo, and the two things this row could say that a stave cannot, that
        a clef or a metre *changes* partway down, were not worth a line of
        small print under every score that has neither.
      */}
      {showing === 'notation' && hasNotation && stave ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.tapHint}>
          Tap a bar to fix it
        </Text>
      ) : null}

      {showing === 'notation' && hasNotation && stave ? (
        <>
          {/*
            Hear what was read, at the tempo the page marked.

            The fastest way to catch a bar OCR got wrong is to listen to it:
            a misread rhythm is obvious in two seconds of playback and nearly
            invisible on a stave you are reading for the first time. Sits with
            the notation rather than in the header because it plays *this*,
            not the piece.
          */}
          <View style={styles.listen}>
            <ListenButton
              score={heard}
              bpm={listenBpm}
              fromMeasure={listenFrom}
              onProgress={(elapsed, total) =>
                setElapsedS(total > 0 ? elapsed : null)
              }
            />
          </View>

          {/*
            **Outside the button's block, because the two want opposite
            widths.** `styles.listen` is `alignSelf: 'flex-start'` so the
            Listen button hugs its label rather than spanning the screen; the
            settings under it are rows, and a row that inherits that is one the
            width of its own text.
          */}
          <PlaybackSettings
            score={heard}
            bars={startable}
            fromMeasure={listenFrom}
            onFromMeasureChange={setFromMeasure}
            bpm={listenBpm}
            beatUnit={piece.score?.tempo_beat_unit}
            onBpmChange={(next) => practiceTempo.set(params.pieceId, next)}
          />

          {/*
              Only where there is something to skip. A control that is always
              there and does nothing on most pieces teaches a musician to stop
              reading the controls — and it says how many bars, because "skip
              long rests" on a page you have not read yet is not a question
              anybody can answer.
            */}
          {skippable > 0 ? (
            /*
              A switch row in the same list as "Listen from" and "Listen at",
              rather than a line of small type under it: it is a listening
              setting like them, and a third rhythm in one list is what the
              owner called not "evenly spaced" (2026-09-23).
            */
            <ToggleRow
              label={skipRests ? `Skipping ${skippable} bars of rest` : `Skip ${skippable} bars of rest`}
              value={skipRests}
              onChange={setSkipRests}
            />
          ) : null}
        </>
      ) : null}

      {showing === 'notation' && hasNotation && stave ? (
        <>
          {describeOmissions(stave) ? (
            <Text
              variant="metadataSmall"
              color="textTertiary"
              style={styles.caveat}
            >
              {describeOmissions(stave)}
            </Text>
          ) : null}

          {reading && !piece.transcriptionAccepted && describeConfidence(reading.confidence) ? (
            <Text variant="metadataSmall" color="textSecondary" style={styles.caveat}>
              {describeConfidence(reading.confidence)}
            </Text>
          ) : null}

          {reading?.notes ? (
            <Text variant="metadataSmall" color="textTertiary" style={styles.caveat}>
              {reading.notes}
            </Text>
          ) : null}

          {/*
            The clef, when nothing read one.

            A quiet line rather than a badge, like every other caveat here —
            but this one carries a cue, because unlike the others it is not a
            thing the musician has to go and look at. They already know the
            answer; the app is the one that doesn't.
          */}
          {!piece.score?.clef ? (
            <Pressable
              onPress={() => setPickingClef(true)}
              accessibilityRole="button"
              accessibilityLabel="Set the clef"
              style={({ pressed }) => [styles.fixRow, pressed && styles.pressed]}
            >
              <Text variant="metadataSmall" color="textSecondary">
                The clef wasn&apos;t read from this page, so the notes above are
                placed as though in {CLEF_LABELS[UNREAD_CLEF_PLACEMENT].toLowerCase()}.
              </Text>
              <Text variant="metadataSmall" color="accentText" style={styles.fixCue}>
                Set the clef
              </Text>
            </Pressable>
          ) : null}

          {/*
            Every bar, not only the ones that fail the check.

            Two compensating errors in one bar still sum correctly — an eighth
            read as a sixteenth and a sixteenth read as an eighth — so the beat
            check is blind to them and so is the "Fix bar N" line above. This
            is the way to a bar the arithmetic thinks is fine and the musician
            can see is not.

            A quiet row, not a second call to action: it is for the rarer case,
            and the flagged bars are what usually needs attention.
          */}
          {/*
            **The screen's actions, as a list instead of a pile.** These were
            three left-aligned accent lines with different margins, stacked
            under three quiet prose lines of the same size — nothing said which
            were statements and which were things you could press, and §3 law 5
            asks for a deliberate vertical system rather than a per-item guess.

            Ruled rows with a chevron each: the same shape the piece screen
            uses for its destinations, and a chevron means it opens, which
            these do (§3 — a drawn affordance does the thing it depicts).
          */}
          {/*
            **The same list as the listening rows, not a second one.** It had
            its own margin and an unruled first row, under a group that closed
            itself with a bottom rule — two lists, two rhythms, a gap between.
            Now every row is ruled on top, and the margin is there only when
            there is no list directly above to continue (`continuesList`).
          */}
          <View style={continuesList ? undefined : styles.actions}>
            {piece.score && piece.score.measures.length > 0 ? (
              <ScoreAction
                label="See every bar"
                onPress={() => setPickingMeasure(true)}
              />
            ) : null}

          {/*
            Only once something has read one — an unread clef has its own line
            above, and two rows offering the same sheet would be one too many.

            Quiet, because a clef that was read is usually right. It is here at
            all because reading it correctly is not the same as it being the
            clef this player reads: a double bass **solo** part is written in
            treble, and a bass or cello part goes into tenor for a high
            passage.
          */}
            {piece.score?.clef ? (
              <ScoreAction
                label="Change the clef"
                onPress={() => setPickingClef(true)}
              />
            ) : null}
          </View>

          {/*
            The sheet closes on the tap, so this is the only thing that says
            the write did not land. Without it a failed correction looks
            exactly like a successful one until the row is read again.
          */}
          {setClef.error ? (
            <Text variant="metadataSmall" color="textSecondary" style={styles.caveat}>
              {setClef.error.message}
            </Text>
          ) : null}
        </>
      ) : null}

      {showing === 'original' && hasPages ? (
        <>
          {/*
            **Every page, not just the first.** The row that leads here says
            "The pages this piece was read from" and drew one image, so a
            musician who photographed a four-page part could not look at the
            bar flagged on page three — the one they most likely came to check.

            A paging scroll view and a line of type, with no chrome of its own:
            the photograph is the music and stays the thing you look at, and
            the count is what tells you there is more (§3 laws 3 and 8). A
            one-page scan renders exactly what it did before — the label is
            silent and the row below it does not appear.
          */}
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            // **Explicit, because a horizontal ScrollView does not shrink to
            // its content on the web build** — it kept `PAGE_HEIGHT` and left
            // a third of the screen empty under a strip of one system.
            style={[styles.pages, pageBox]}
            onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}
            onScroll={(event) =>
              setPageIndex(
                pageAtOffset(
                  event.nativeEvent.contentOffset.x,
                  pageWidth,
                  piece.pages.length,
                ),
              )
            }
            // Often enough to keep the caption honest mid-swipe, rarely enough
            // not to re-render on every frame of one.
            scrollEventThrottle={64}
          >
            {piece.pages.map((page, index) => (
              <ScoreThumbnail
                key={index}
                source={page}
                // The whole page, not a crop of it: this view exists so a
                // musician can read the bar that was flagged, and `cover` drew
                // a band of a few notes across the middle of it.
                fit="contain"
                style={[styles.page, pageBox]}
              />
            ))}
          </ScrollView>

          {describePagePosition(pageIndex, piece.pages.length) ? (
            <Text
              variant="metadataSmall"
              color="textTertiary"
              style={styles.pagePosition}
            >
              {describePagePosition(pageIndex, piece.pages.length)}
            </Text>
          ) : null}
        </>
      ) : null}

      {/*
        The state this screen had no answer for.

        Everything above — the stave, the clef row, the caveats, the way in to
        fixing a bar — is gated on there being something drawable. `DRAWABLE`
        holds four note values, so a part written in sixteenths and dotted
        eighths loses every note, and what a musician got was the title, the
        photograph, and nothing else: no explanation, no action, no sign that
        anything had been read at all. It usually had been.

        A line rather than a panel. The photograph is the music and should stay
        the thing you look at; this only has to account for the missing stave.
      */}
      {!hasNotation && stave && describeUndrawnScore(stave) ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.caveat}>
          {describeUndrawnScore(stave)}
        </Text>
      ) : null}

      {/*
        Says which kind of "no photograph" this is. A piece typed in by hand
        never had one; this one had one and it was spent. Without the line the
        missing Original toggle reads as something broken.
      */}
      {piece.pageImageDiscarded ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.caveat}>
          You accepted this reading, so the photograph it came from was
          discarded.
        </Text>
      ) : null}

      {/*
        The accept action, last on the screen and therefore nearest the thumb
        (§3 law 7) — and last in reading order too, which is the right place
        for a decision that only makes sense after looking at everything above
        it.

        Absent unless there is something to accept: a reading still in flight
        has no notation yet, and a failed one needs its photograph precisely
        because there is no transcription to replace it with. The backend
        refuses both as well; this is so the control never appears in a state
        where tapping it would be a mistake.
      */}
      {hasNotation && !piece.transcriptionAccepted ? (
        <View style={styles.accept}>
          <PrimaryButton
            label="Looks right"
            onPress={() => setConfirmingAccept(true)}
            loading={accept.isPending}
            disabled={accept.isPending}
          />
          <Text variant="metadataSmall" color="textTertiary" style={styles.acceptNote}>
            Deletes the photo to save space.
          </Text>
          {acceptError ? (
            <Text variant="metadataSmall" color="textSecondary" style={styles.caveat}>
              {acceptError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/*
        **A grid, because a bar is found by its number and a *wrong* bar is
        not.** This was a list of one row per bar, and on a seventy-bar study
        that meant finding the misread bar required already knowing which one
        it was. Sixteen cells fit on a screen, and a bar holding two notes
        where its neighbours hold eight is then visible as a shape, before any
        check has run on it — which matters because the beat check is blind to
        two compensating errors and to a bar the reader skipped half of.

        **No verdict colour.** `colors.ts` quarantines that trio to the screen
        that reports how a take went, and a bar that does not add up is not a
        performance. The border firms up and the ink goes to full strength,
        which is the same distinction `PracticeSetup` draws and is legible in
        both appearances.

        `barGrid.ts` holds the cells and the summary, with tests.
      */}
      <BottomSheet
        visible={pickingMeasure}
        onClose={() => setPickingMeasure(false)}
        title="Which bar?"
      >
        <Text variant="metadataSmall" color="textTertiary" style={styles.gridNote}>
          {barGridSummary(cells)}
        </Text>
        <ScrollView style={styles.measureList}>
          <View style={styles.grid}>
            {cells.map((cell) => (
              <Pressable
                key={cell.number}
                onPress={() => {
                  setPickingMeasure(false);
                  navigation.navigate('MeasureEdit', {
                    pieceId: piece.id,
                    measureNumber: cell.number,
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel={cell.label}
                style={({ pressed }) => [
                  styles.gridCell,
                  cell.flagged && styles.gridCellFlagged,
                  pressed && styles.pressed,
                ]}
              >
                <Text variant="button" color={cell.flagged ? 'textPrimary' : 'textSecondary'}>
                  {cell.number}
                </Text>
                <Text
                  variant="metadataSmall"
                  color={cell.flagged ? 'textSecondary' : 'textTertiary'}
                >
                  {cell.notes}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </BottomSheet>

      {/*
        Four rows and no explanation of what a clef is. Anyone reading a part
        on a stand knows; anyone who doesn't is not helped by a sentence here.

        "Not stated" is last and is a real choice, not a cancel — a part can
        honestly carry no clef, and clearing it back to that has to be possible
        or a wrong tap becomes permanent. The sheet closes on the tap rather
        than waiting for the round trip: the write is one field, and holding a
        sheet open over a spinner for it would make a correction feel like a
        transaction.
      */}
      <BottomSheet
        visible={pickingClef}
        onClose={() => setPickingClef(false)}
        title="Which clef?"
      >
        <View style={styles.clefList}>
          {CLEF_ORDER.map((clef) => (
            <Pressable
              key={clef}
              onPress={() => {
                setPickingClef(false);
                setClef.mutate(clef);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: piece.score?.clef === clef }}
              aria-pressed={piece.score?.clef === clef}
              style={({ pressed }) => [styles.clefRow, pressed && styles.pressed]}
            >
              <Text
                variant="body"
                color={piece.score?.clef === clef ? 'accentText' : 'textPrimary'}
              >
                {CLEF_LABELS[clef]}
              </Text>
            </Pressable>
          ))}

          <Pressable
            onPress={() => {
              setPickingClef(false);
              setClef.mutate(null);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: !piece.score?.clef }}
            aria-pressed={!piece.score?.clef}
            style={({ pressed }) => [styles.clefRow, pressed && styles.pressed]}
          >
            <Text
              variant="body"
              color={piece.score?.clef ? 'textTertiary' : 'accentText'}
            >
              Not stated
            </Text>
          </Pressable>
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={confirmingAccept}
        title="Delete the photo?"
        // The consequence, not the verb. Naming what survives matters as much
        // as naming what goes: someone who thinks they are deleting the piece
        // will cancel a thing they actually wanted.
        message="The notes stay. The photo can’t be recovered."
        confirmLabel="Delete photo"
        onConfirm={() => {
          setConfirmingAccept(false);
          setAcceptError(null);
          accept.mutate(undefined, {
            onError: (cause) =>
              setAcceptError(
                cause instanceof Error
                  ? cause.message
                  : 'That could not be saved. Try again.',
              ),
          });
        }}
        onCancel={() => setConfirmingAccept(false)}
      />
    </ScreenContainer>
  );
}

/**
 * One thing this screen can do, as a row.
 *
 * **Not a card and not a bare accent line.** The three actions here used to be
 * left-aligned accent text with per-item margins, sitting among prose caveats
 * of the same size — so nothing distinguished a statement from a control, and
 * the block read as leftovers rather than a list (§3 laws 5 and 8). A rule and
 * a chevron do that work for a pixel each, which is the same call the library's
 * own rows and the piece screen's destinations make.
 */
function ScoreAction({
  label,
  divided = true,
  onPress,
}: {
  label: string;
  divided?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.action,
        divided && styles.actionRuled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.actionCopy}>
        <Text variant="rowLabel">{label}</Text>
      </View>
      {/* A chevron means it opens, and each of these opens something. */}
      <TrailingChevron />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingTop: spacing.md,
    marginBottom: spacing.lg,
  },
  title: {
    marginTop: spacing.xs,
    fontSize: 26,
    lineHeight: 31,
  },
  /*
    Every tappable thing on this screen acknowledges the touch. These were bare
    `Pressable`s with a static style, so a tap produced no response at all until
    whatever it triggered appeared — which on a slow action reads as the control
    being dead. `PressableScale` is for the large targets; the app's answer for
    small ones is a colour or opacity change, and these had neither.
  */
  pressed: {
    opacity: pressedOpacity,
  },
  /**
   * The paper.
   *
   * **The one place in this app where a surface is the right answer**, and it
   * is worth saying why, because §3 law 3 rules out exactly this move and law
   * 6 calls a container an exception rather than a default. The exception here
   * is not decorative: what is being shown *is* a page of music, and the whole
   * of the owner's request was that it read as one — "make it generate a sort
   * of sheet music page look, like how you see on music score or flat io".
   * Every engraving application on earth draws white paper for the same reason
   * a printed part is white: staff lines and noteheads are black ink, and ink
   * on paper is what a musician's eye is trained on.
   *
   * White, not the app's warm ivory, and squared off rather than rounded — a
   * rounded page is a card pretending to be paper. The hairline is the sheet's
   * edge; there is no shadow, because a page lying on a stand does not float.
   */
  plate: {
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    /*
      **It said "full-bleed to the screen edges" and was eight points short on
      each side.** `ScreenContainer`'s gutter is `SCREEN_GUTTER`, which is
      `spacing.xl`; this cancelled `spacing.lg`. The result was a bordered
      white rectangle inset from both edges — which is a card in a list, the
      exact thing the comment was written to prevent, and what the screen
      actually looked like.

      Cancelling the real gutter is what `SCREEN_GUTTER` is exported for, and
      it is how `PieceDetailScreen`'s band has always done it.
    */
    marginHorizontal: -SCREEN_GUTTER,
    /*
      **Two edges, not four.** A border all the way round a full-bleed element
      draws two vertical hairlines down the screen edges, which reads as a
      frame rather than as paper. The sheet's top and bottom edges are the only
      ones a page on a stand actually has.
    */
    borderTopWidth: BORDER_WIDTH,
    borderBottomWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  tapHint: {
    marginTop: spacing.md,
  },
  caveat: {
    marginTop: spacing.lg,
  },
  reviewFirst: {
    marginTop: spacing.xl,
  },
  fixRow: {
    marginTop: spacing.lg,
    // **A latent miss in a shared style.** Every row that used this happened to
    // carry two lines of text, so it cleared the floor by accident; the first
    // one-line message on it measured 40pt. Justified rather than centred, so
    // the extra height falls below the text instead of pushing the cue away
    // from the message it belongs to.
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  measureList: {
    maxHeight: 380,
  },
  gridNote: {
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridCell: {
    // Four to a row at 390pt inside the sheet's own padding, and a square, so
    // the grid reads as a page of bars rather than a table.
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  gridCellFlagged: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.surfacePressed,
  },
  measureRow: {
    minHeight: 56,
    justifyContent: 'center',
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  clefList: {
    // Five rows fit; the sheet needs no scroller and gets none.
    paddingBottom: spacing.xs,
  },
  clefRow: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  recoveryAction: {
    marginTop: spacing.lg,
  },
  recoverySecondary: {
    marginTop: spacing.sm,
  },
  /**
   * The two quiet sheet-openers: "Correct another bar" and "Change the clef".
   *
   * **Left-aligned, and that is the whole change.** They were `alignSelf:
   * 'center'`, the only centred controls in an app where every other line
   * starts at the gutter — so they read as floating rather than as part of the
   * column (§3 law 5).
   *
   * They stay quiet, deliberately. A design review proposed promoting them to
   * `LinkRow`s with chevrons; that was wrong twice over. Neither opens a
   * screen — both set local state that raises a `BottomSheet` — so a chevron
   * would be an affordance that does not do what it depicts. And their
   * quietness is a decision with its own reasons written above each of them:
   * the flagged bars are what usually needs attention, and a clef that was
   * read is usually right.
   */
  actions: {
    marginTop: spacing.xl,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: ROW_PADDING_VERTICAL,
    minHeight: MIN_TOUCH_TARGET,
  },
  actionRuled: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  actionCopy: {
    flex: 1,
    minWidth: 0,
  },

  fixCue: {
    marginTop: spacing.xs,
  },
  pages: {
    marginTop: spacing.xl,
  },
  page: {
    // Width comes from the measured viewport once layout has run, so a page is
    // exactly one screen and `pagingEnabled` lands on boundaries. `100%` inside
    // a horizontal ScrollView is the content's width, not the viewport's, which
    // collapses every page onto the first.
    width: '100%',
    height: PAGE_HEIGHT,
  },
  pagePosition: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  pageWhileReading: {
    width: '100%',
    height: PAGE_HEIGHT_WHILE_READING,
    marginTop: spacing['3xl'],
  },
  listen: {
    marginTop: spacing.xl,
    alignSelf: 'flex-start',
  },
  skipToggle: {
    marginTop: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  accept: {
    marginTop: spacing['3xl'],
  },
  acceptNote: {
    marginTop: spacing.md,
  },
});
