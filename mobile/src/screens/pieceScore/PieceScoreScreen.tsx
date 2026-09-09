import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Camera, Images } from 'lucide-react-native';
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
  MetadataRow,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  SegmentedControl,
  Text,
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
  spacing,
} from '../../design';
import {
  describeOmissions,
  describeUndrawnScore,
  staveScoreFor,
} from '../../lib/notation/fromScore';
import { shortenLongRests, skippableBars } from '../../lib/notation/longRests';
import { CLEF_LABELS, clefSummary, meterSummary } from '../../lib/notation/scoreSummary';
import {
  scheduleScore,
  soundingMeasureAt,
  startAtMeasure,
  startableMeasures,
} from '../../lib/score';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { bpmForMarking } from '../../lib/tempoMarking';
import { formatTempo } from '../../lib/tempo';
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
  const { data: piece, isPending, isError } = usePiece(params.pieceId);

  const accept = useAcceptTranscription(params.pieceId);
  const reread = useRetranscribe(params.pieceId);
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

  if (isPending) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (isError || !piece) {
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
          eyebrow={piece.composer}
          title={piece.title}
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
          eyebrow={piece.composer}
          title={piece.title}
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
          title="This page couldn't be read"
          description={
            piece.transcriptionError ??
            'Something went wrong reading this page.'
          }
          actionLabel={reread.isPending ? 'Reading again…' : 'Try reading it again'}
          // The label said it was working; the button carried on accepting
          // taps, and each one started another reading of the same page. The
          // server refuses the second now, but a musician should not have to
          // meet that refusal to learn the first tap landed.
          actionDisabled={reread.isPending}
          onActionPress={() => {
            setAcceptError(null);
            reread.mutate(undefined, {
              onError: (cause) =>
                setAcceptError(
                  cause instanceof Error
                    ? cause.message
                    : 'That could not be started. Try again.',
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
          label="Take new photographs instead"
          icon={Camera}
          onPress={() =>
            navigation.navigate('Scanner', { attachToPieceId: piece.id })
          }
          disabled={reread.isPending}
          style={styles.recoveryAction}
        />
        <SecondaryButton
          label="Choose different images"
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
        <Text variant="metadataSmall" color="textTertiary" style={styles.caveat}>
          The piece is still in your library, with its title and its tempo.
          Only the notation is missing.
        </Text>
        {hasPages ? (
          <ScoreThumbnail source={piece.thumbnail} style={styles.pageWhileReading} />
        ) : null}
      </ScreenContainer>
    );
  }

  // Both halves exist only when the piece was photographed *and* transcribed.
  // A piece entered by hand has neither, and a toggle between two absences
  // would be the emptiest control in the app (§3 law 10).
  const showToggle = hasNotation && hasPages;
  const showing: ScoreView = showToggle ? view : hasNotation ? 'notation' : 'original';

  return (
    <ScreenContainer key={showing}>
      <PageHeader
        eyebrow={piece.composer}
        title={piece.title}
        onBack={goBack}
        backLabel="Back to piece"
      />

      {/*
        What a printed part states in its top-left corner.

        The stave draws the clef now, and draws it again wherever the page
        changes it — so this line is no longer the only thing standing between
        a reader and the wrong pitch. It still earns its place: it names the
        metre and the marked tempo, and it says **whether the clef or the metre
        lasts**, which the stave can only show by being scrolled through.
        `scoreSummary` holds those rules, where they are tested.
      */}
      {showing === 'notation' && hasNotation ? (
        <MetadataRow
          variant="metadataSmall"
          items={[
            ...clefSummary(piece.score),
            ...meterSummary(piece.score),
            piece.score?.tempo_marking,
            piece.markedBpm
              ? formatTempo(piece.markedBpm, piece.score?.tempo_beat_unit)
              : null,
          ]}
          style={styles.scoreMeta}
        />
      ) : null}

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
            />
          )}
          </View>
        </View>
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
              <Pressable
                accessibilityRole="switch"
                // The ARIA props, not `accessibilityState`: react-native-web
                // drops `checked` entirely, so the web build would announce a
                // switch with no on or off. Same reasoning as the metronome
                // toggle on the record screen.
                aria-checked={skipRests}
                accessibilityLabel="Skip long rests"
                onPress={() => setSkipRests((on) => !on)}
                style={({ pressed }) => [styles.skipToggle, pressed && styles.pressed]}
              >
                {/*
                  Not gold when on. At 13px the accent is 3.54:1, under the
                  4.5:1 floor — the record screen learned this and `audit-a11y`
                  holds the line. The words carry the state; the weight of the
                  colour says whether the line does anything.
                */}
                <Text
                  variant="metadataSmall"
                  color={skipRests ? 'textPrimary' : 'textTertiary'}
                >
                  {skipRests
                    ? `Skipping ${skippable} bars of rest`
                    : `Skip ${skippable} bars of rest`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}

      {showing === 'notation' && hasNotation && stave ? (
        <>
          {/*
            What the reading is unsure about, in order of how much it matters.

            Bars that don't add up first: that is arithmetic, not an opinion,
            and it is the failure that corrupts a verdict — `alignment.py`
            builds its expected timeline from these durations, so one bad bar
            pushes every bar after it out of step.

            Then what the engraver could not draw, then whatever the model
            chose to say. Three quiet lines, not three badges: none of them is
            an alert, and boxing them would make the caveats louder than the
            music (§3 laws 3 and 6).
          */}
          {/*
            The bars that don't add up are the way in to fixing them.

            Naming a problem the musician cannot act on is the failure this
            replaces: until now a misread duration meant re-photographing the
            page or abandoning the piece, on a design whose spec assumed you
            could fix a bar in ten seconds (intempo-combined.md:447). The line
            was already here; it just did nothing.

            Tapping opens the first broken bar. One tap for the common case of
            a single bad bar, and the screen names the rest as you fix them.
          */}
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
          {piece.score && piece.score.measures.length > 0 ? (
            <Pressable
              onPress={() => setPickingMeasure(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondaryRow, pressed && styles.pressed]}
            >
              <Text variant="metadataSmall" color="accentText">
                Correct another bar
              </Text>
            </Pressable>
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
            <Pressable
              onPress={() => setPickingClef(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondaryRow, pressed && styles.pressed]}
            >
              <Text variant="metadataSmall" color="accentText">
                Change the clef
              </Text>
            </Pressable>
          ) : null}

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
            Confirms the reading and deletes the photograph it came from, which
            is most of what this piece takes up.
          </Text>
          {acceptError ? (
            <Text variant="metadataSmall" color="textSecondary" style={styles.caveat}>
              {acceptError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/*
        A plain list, because a bar is found by its number and nothing else.
        Bars that do not add up are marked, so the sheet doubles as the whole
        picture of what the reading is unsure about.
      */}
      <BottomSheet
        visible={pickingMeasure}
        onClose={() => setPickingMeasure(false)}
        title="Which bar?"
      >
        <ScrollView style={styles.measureList}>
          {(piece.score?.measures ?? []).map((measure) => {
            const flagged = reading?.problemMeasures.includes(measure.measure_number);
            return (
              <Pressable
                key={measure.measure_number}
                onPress={() => {
                  setPickingMeasure(false);
                  navigation.navigate('MeasureEdit', {
                    pieceId: piece.id,
                    measureNumber: measure.measure_number,
                  });
                }}
                accessibilityRole="button"
                style={({ pressed }) => [styles.measureRow, pressed && styles.pressed]}
              >
                <Text variant="body">Bar {measure.measure_number}</Text>
                <Text variant="metadataSmall" color={flagged ? 'textSecondary' : 'textTertiary'}>
                  {measure.notes.length}{' '}
                  {measure.notes.length === 1 ? 'note' : 'notes'}
                  {flagged ? " · doesn't add up" : ''}
                </Text>
              </Pressable>
            );
          })}
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
        title="Delete the photograph?"
        // The consequence, not the verb. Naming what survives matters as much
        // as naming what goes: someone who thinks they are deleting the piece
        // will cancel a thing they actually wanted.
        message={`The notes stay in your library. The photograph of the page is deleted and cannot be recovered — so check the notation above first.`}
        confirmLabel="Delete photograph"
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

const styles = StyleSheet.create({
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
  scoreMeta: {
    marginTop: spacing.sm,
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
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    // Full-bleed to the screen edges: a page with the app's own margin either
    // side of it reads as a card in a list. Sheet music fills the paper.
    marginHorizontal: -spacing.lg,
  },
  caveat: {
    marginTop: spacing.lg,
  },
  fixRow: {
    marginTop: spacing.lg,
  },
  measureList: {
    maxHeight: 380,
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
  secondaryRow: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.md,
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
