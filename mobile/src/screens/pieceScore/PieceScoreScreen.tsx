import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { Stave } from '../../components/notation/Stave';
import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { ListenButton } from '../../components/score/ListenButton';
import { TranscribingPanel } from '../../components/score/TranscribingPanel';
import {
  EmptyState,
  LoadingState,
  MetadataRow,
  PageHeader,
  ScreenContainer,
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
import { BORDER_WIDTH, colors, MIN_TOUCH_TARGET, spacing } from '../../design';
import {
  describeOmissions,
  describeUndrawnScore,
  staveScoreFor,
} from '../../lib/notation/fromScore';
import { shortenLongRests, skippableBars } from '../../lib/notation/longRests';
import { scheduleScore } from '../../lib/score';
import {
  describeConfidence,
  describeProblemMeasures,
  readingNotesFor,
} from '../../lib/notation/reading';
import type { Clef } from '../../data/types';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';

/** Read from a stand, not glanced at — the same size the warmup page uses. */
const STAVE_SCALE = 1.25;

/**
 * How a clef is named in prose.
 *
 * Spelled out rather than drawn: `engrave.ts` deliberately draws no clef, and a
 * hand-approximated treble clef would be the first thing a musician noticed.
 */
const CLEF_LABELS: Record<Clef, string> = {
  treble: 'Treble clef',
  bass: 'Bass clef',
  alto: 'Alto clef',
  tenor: 'Tenor clef',
};

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
 * The same page while it is still being read.
 *
 * Shorter, because the screen is about the reading at that moment and a
 * full-height photograph would be the first thing the eye lands on — two
 * focal points, and the wrong one dominant (§3 law 4). It stays on screen
 * rather than being removed because confirming the right page went up is a
 * real thing to want while waiting.
 */
const PAGE_HEIGHT_WHILE_READING = 240;

/**
 * The tempo to hear the transcription at when the page named none.
 *
 * A study tempo, not a claim about the music. Slow enough that a wrong bar is
 * audible as a wrong bar rather than a blur, which is the entire reason to
 * play a transcription back.
 */
const FALLBACK_LISTEN_BPM = 72;

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
  const playback = useMemo(
    () => (heard ? scheduleScore(heard, piece?.markedBpm ?? FALLBACK_LISTEN_BPM) : null),
    [heard, piece?.markedBpm],
  );
  const soundingMeasure = useMemo(() => {
    if (elapsedS === null || !playback) {
      return null;
    }
    // The last note that has started. A note still sounding is where the ear
    // is, so the bar stays lit through the note rather than blinking off in
    // the gap `articulation` leaves before the next one.
    let current: number | null = null;
    for (const note of playback.notes) {
      if (note.startS > elapsedS) {
        break;
      }
      current = note.measureNumber;
    }
    return current;
  }, [elapsedS, playback]);

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
          title="Couldn't open this score"
          description="The piece may have been removed from your library."
          actionLabel="Back"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  const hasNotation = (stave?.items.length ?? 0) > 0;
  const hasPages = piece.thumbnail !== null;

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
          onBack={() => navigation.goBack()}
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
          onBack={() => navigation.goBack()}
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
        <Pressable
          onPress={() => navigation.navigate('Scanner')}
          accessibilityRole="button"
          style={styles.secondaryRow}
        >
          <Text variant="metadataSmall" color="accent">
            Photograph it again instead
          </Text>
        </Pressable>
        {/*
          The piece is still real and still practisable — it is in the library,
          it has a title and a tempo, and the metronome does not need notes.
          Saying so stops a failed read reading as a lost piece.
        */}
        <Text variant="metadataSmall" color="textTertiary" style={styles.caveat}>
          The piece is still in your library. You can practise it with the
          metronome; only the verdict needs the notation.
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
    <ScreenContainer>
      <PageHeader
        eyebrow={piece.composer}
        title={piece.title}
        onBack={() => navigation.goBack()}
        backLabel="Back to piece"
      />

      {/*
        What a printed part states in its top-left corner, and what the stave
        cannot: nothing here draws a clef, so without this line the same
        notehead is a different pitch to a violist than to a violinist.
      */}
      {showing === 'notation' && hasNotation ? (
        <MetadataRow
          variant="metadataSmall"
          items={[
            piece.score?.clef ? CLEF_LABELS[piece.score.clef] : 'Clef not read',
            piece.score?.time_signature && piece.score.time_signature !== 'unknown'
              ? piece.score.time_signature
              : null,
            piece.score?.tempo_marking,
            piece.markedBpm ? `${piece.markedBpm} BPM` : null,
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
          title="No score to show"
          description="This piece was entered by hand, so there is no transcription and no photograph. Photograph the music to get both."
        />
      ) : null}

      {showing === 'notation' && hasNotation && stave ? (
        <View style={styles.plate} onLayout={measure}>
          {width === null ? null : (
            <Stave
              notes={stave.items}
              highlightMeasure={soundingMeasure}
              clef={piece.score?.clef ?? UNREAD_CLEF_PLACEMENT}
              maxWidth={width}
              scale={STAVE_SCALE}
              justify
              // A letter under every note is a study-book aid. On repertoire it
              // reads as a crib, so the clef is stated as metadata above
              // instead — which is where a clef belongs on a screen for reading
              // music, and is the obligation `showNoteNames={false}` carries.
              showNoteNames={false}
            />
          )}

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
              bpm={piece.markedBpm ?? FALLBACK_LISTEN_BPM}
              onProgress={(elapsed, total) =>
                setElapsedS(total > 0 ? elapsed : null)
              }
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
                style={styles.skipToggle}
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
              style={styles.fixRow}
            >
              <Text variant="metadataSmall" color="textSecondary">
                {describeProblemMeasures(reading.problemMeasures, {
                  canCheck: hasPages,
                  concerns: reading.concerns,
                })}
              </Text>
              <Text variant="metadataSmall" color="accent" style={styles.fixCue}>
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
              style={styles.fixRow}
            >
              <Text variant="metadataSmall" color="textSecondary">
                The clef wasn&apos;t read from this page, so the notes above are
                placed as though in {CLEF_LABELS[UNREAD_CLEF_PLACEMENT].toLowerCase()}.
              </Text>
              <Text variant="metadataSmall" color="accent" style={styles.fixCue}>
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
              style={styles.secondaryRow}
            >
              <Text variant="metadataSmall" color="accent">
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
              style={styles.secondaryRow}
            >
              <Text variant="metadataSmall" color="accent">
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
        </View>
      ) : null}

      {showing === 'original' && hasPages ? (
        <ScoreThumbnail source={piece.thumbnail} style={styles.page} />
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
                style={styles.measureRow}
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
              style={styles.clefRow}
            >
              <Text
                variant="body"
                color={piece.score?.clef === clef ? 'accent' : 'textPrimary'}
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
            style={styles.clefRow}
          >
            <Text
              variant="body"
              color={piece.score?.clef ? 'textTertiary' : 'accent'}
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
        message={`The transcription stays in your library. The photograph of the page is deleted and cannot be recovered — so check the notation above first.`}
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
  scoreMeta: {
    marginTop: spacing.sm,
  },
  plate: {
    marginTop: spacing.xl,
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
  secondaryRow: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  fixCue: {
    marginTop: spacing.xs,
  },
  page: {
    width: '100%',
    height: PAGE_HEIGHT,
    marginTop: spacing.xl,
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
