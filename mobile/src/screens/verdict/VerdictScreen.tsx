import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useGoBack } from '../../navigation/useGoBack';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  BackLink,
  EmptyState,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SegmentedControl,
  Text,
} from '../../components/primitives';
import { VerdictSkeleton } from '../../components/skeletons';
import { takeSource } from '../../data/sources';
import type { MeasureVerdict, TakeResult, UserVerdict } from '../../data/types';
import { MIN_TOUCH_TARGET, spacing } from '../../design';
import { formatTakeVerdict } from '../../lib/tempo';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { appVerdictForBar, barTempo } from '../../lib/verdict/barTempo';
import { readMeasure } from '../../lib/verdict/measureReading';
import { takePitchTrend, tempoTrend } from '../../lib/verdict/trend';
import { pitchWord } from '../../lib/verdict/intonation';
import { namedMarks, noteDetail, notesLine, takeNoteMarks } from '../../lib/verdict/pitchByNote';
import { NoteRow } from '../../components/charts/NoteRow';
import { headlinePassage, practiceLabel } from '../../lib/verdict/passage';
import { mistakeBars, mistakesInPassage } from '../../lib/verdict/mistakes';
import {
  barsLabel,
  pitchPassageAt,
  pitchPassageLine,
  tempoPassageAt,
  tempoPassageLine,
} from '../../lib/verdict/barPassage';
import {
  failureTitle,
  intakeRefusal,
  nothingUsableDetail,
  nothingUsableTitle,
} from '../../lib/verdict/failureTitle';
import { canCorrect } from '../../lib/verdict/correction';
import { success } from '../../lib/haptics';
import { useSubmitCorrection } from '../../data/hooks/useCorrections';
import { CorrectionPrompt, type CorrectionState } from './CorrectionPrompt';
import { MeasureBars } from './MeasureBars';
import { TrendChart } from './TrendChart';
import { TakePlayback } from './TakePlayback';
import { loadStateFor } from '../../lib/loadState';

/**
 * What one take came back as.
 *
 * The order is the spec's: the verdict word first, then the sentence, then the
 * shape of the take, then the measure-by-measure detail for anyone who wants
 * it. Someone who reads only the top of this screen should already know what
 * happened.
 *
 * This is the one screen the verdict colours are allowed on. They repeat what
 * the words already say and are never the only signal — every coloured thing
 * here sits beside its own label, because red-green deficiency maps almost
 * exactly onto this trio. The headline stays charcoal: a take that drifted is
 * feedback, and a red sentence at screen-title size reads as an error.
 */
export function VerdictScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Verdict'>>();
  const fromTakes = params.from === 'takes';
  /** The measure the chart has open; null until chosen, meaning `openingMeasure`. */
  const [selected, setSelected] = useState<number | null>(null);
  /** Which of the two readings the one chart draws. */
  const [view, setView] = useState<'tempo' | 'pitch'>('tempo');
  /** The written note tapped under the pitch graph, by MIDI number. */
  const [note, setNote] = useState<number | null>(null);

  /*
    **One question for the take, not one per bar** (2026-09-29). Where it has
    got to; not persisted beyond the screen — the server appends rather than
    replaces, so a second answer is a second opinion and both are data.
  */
  const [answer, setAnswer] = useState<CorrectionState>({ kind: 'idle' });
  const submitCorrection = useSubmitCorrection();

  /**
   * The musician's answer about a passage, sent as one correction per bar in
   * it — the shape the dataset has always had, so every threshold is still
   * checked bar by bar. Each is sent with the app's own reading of that bar
   * (`appVerdictForBar`): the dataset exists to compare the two.
   */
  function answerFor(bars: readonly MeasureVerdict[], choice: UserVerdict, reading: (m: MeasureVerdict) => UserVerdict) {
    setAnswer({ kind: 'sending', choice });
    submitCorrection.mutate(
      {
        analysisId: params.analysisId,
        corrections: bars.map((m) => ({
          measure_number: m.measure,
          app_verdict: reading(m),
          user_verdict: choice,
        })),
      },
      {
        onSuccess: () => {
          // Felt as well as seen: the answer arrived.
          success();
          setAnswer({ kind: 'sent', choice });
        },
        onError: (error: unknown) =>
          setAnswer({
            kind: 'failed',
            /*
              The error's own words, matching `ProfileScreen`'s convention for
              the same shape of write. **Not `describeLoadError`**, whose
              fallback replaced the hook's own "Sending feedback needs the
              backend. This build is running on sample data." with a guess
              that was both wrong and unactionable (`describeError.ts`).
            */
            message: error instanceof Error ? error.message : 'Couldn’t send. Try again.',
          }),
      },
    );
  }

  const { data: take, isError } = useQuery<TakeResult | null>({
    queryKey: ['take', params.analysisId],
    queryFn: () => takeSource.getTake(params.analysisId),
  });
  const load = loadStateFor({ isError, hasData: take !== undefined });

  /**
   * The piece is only known once the take has loaded, and these branches run
   * when it has not or when it failed. `Library` is the honest fallback there:
   * the success path below navigates to the piece by name, which is what a
   * verdict's back control should do when there is a piece to name.
   */
  const goBack = useGoBack(
    take ? { route: 'PieceDetail', params: { pieceId: take.pieceId } } : { tab: 'Library' },
  );

  if (load === 'loading') {
    return (
      <ScreenContainer>
        <VerdictSkeleton />
      </ScreenContainer>
    );
  }

  if (load === 'unavailable' || !take) {
    return (
      <ScreenContainer>
        <EmptyState
          fill
          title="Couldn't load this take"
          actionLabel="Back"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  // The run itself failed — the audio couldn't be fetched, the pipeline threw,
  // or the row was swept up as stuck. Distinct from the branch below, where
  // the pipeline ran fine and reports that it heard nothing usable, and
  // distinct again from the take not existing.
  //
  // `failure_reason` is a machine token (`audio_unavailable`,
  // `internal_error`), so it is not shown. What the musician needs to know is
  // whether playing it again is worth their time, and the backend already
  // answers that: it marks a stuck row `failed_recoverable` "so the client can
  // offer a retry". The recording is theirs either way and nothing about it
  // was wrong, which is the first thing to say.
  if (take.failure) {
    /**
     * **A file refused before decoding is not a failed analysis**, and the
     * sentence written for one is wrong for the other. `audio_intake.py`
     * refuses an upload for six named reasons; each has its own next move, and
     * none of them is "your playing wasn't the problem" — the playing was
     * never involved. `null` for every other reason, which keeps the
     * pipeline's own failures on the copy written for them.
     */
    const refused = intakeRefusal(take.failure.reason);

    return (
      <ScreenContainer
        footer={
          <PrimaryButton
            // A refused file is not something to play again: the record
            // screen is still the destination, because that is where both
            // "record" and "upload" live, but the label must not tell someone
            // to perform the piece over a file that was too long.
            label={
              refused
                ? 'Back to the piece'
                : take.failure.recoverable
                  ? 'Try again'
                  : 'Record again'
            }
            onPress={() =>
              navigation.replace('Record', { pieceId: take.pieceId })
            }
          />
        }
      >
        {/*
          **Centred, like the empty states on Today and Insights** (owner's
          call, 2026-09-02, on seeing this screen rendered for the first time).
          To a musician this is an empty state: nothing to show, one thing to
          do. Left at the top it put a short sentence in the first quarter of
          the screen with two thirds of the page blank beneath it.

          The header keeps only the back control and the piece, because the
          finding has moved into the centred block — a screen has one dominant
          focal point (§3 law 4), and it should be the outcome rather than the
          title of the piece.
        */}
        <PageHeader
          onBack={goBack}
          backLabel="Back to the piece"
        />
        <EmptyState
          fill
          // **The finding, not the app's process.** The heading is the one
          // thing on a centred empty state set in the display face, so it is
          // what is read first and sometimes only — and "this take didn't get
          // analysed" is the least useful true thing available. See
          // `failureTitle`, which also decides that the recoverable one owns
          // it rather than leaving ownership to the third line.
          title={refused ? refused.title : failureTitle(take.failure)}
          /*
            **The heading owns it now, so the body stops repeating it.** Both
            of these opened by restating the heading — "Something went wrong on
            our end" over "Something went wrong on our side" — which spent the
            first line of the explanation saying nothing new. What is left is
            the two things a musician actually wants: it was not their playing,
            and whether trying again is worth the time.

            `tools/verdict-states.mjs` holds the sentences these two checks
            match on, and it is one file because the last time they were two
            the walk and the audit went out of step for a push.
          */
          // Nothing under the heading but a refusal's own directions (the
          // owner's sweep, 2026-09-29): "Not your playing. Try again." sat
          // over a button that says Try again.
          description={refused ? refused.description : undefined}
        />
        {take.recordingAvailable ? (
          <TakePlayback analysisId={take.id} />
        ) : null}
      </ScreenContainer>
    );
  }

  // The pipeline finished but heard nothing it could use. That is an outcome
  // with a sentence attached, not a failure to report as one.
  if (take.status !== 'ok') {
    return (
      <ScreenContainer
        footer={
          <PrimaryButton
            label="Record again"
            onPress={() =>
              navigation.replace('Record', { pieceId: take.pieceId })
            }
          />
        }
      >
        {/* Centred for the same reason as the branch above. */}
        <PageHeader
          onBack={goBack}
          backLabel="Back to the piece"
        />
        {/* The pipeline's own sentence, shown verbatim. */}
        {/*
          **Three outcomes shared this heading.** A completely silent take, one
          the pipeline could not line up against the page and one that turned
          out to be a different piece all read "Nothing to measure" — three
          findings with three next moves under a sentence naming none of them.
          The pipeline's own explanation underneath does distinguish them, and a
          musician who reads the heading and stops was told nothing.
        */}
        <EmptyState
          fill
          title={nothingUsableTitle(take.status)}
          description={nothingUsableDetail(take.status, take.headline) ?? undefined}
        />
        {take.recordingAvailable ? (
          <TakePlayback analysisId={take.id} />
        ) : null}
      </ScreenContainer>
    );
  }

  const reading = (m: MeasureVerdict) =>
    appVerdictForBar(m, take.targetBpm, take.tempoBeatUnit, take.tolerance);
  // The take as a trend (`lib/verdict/trend.ts`): its tempo, and its pitch
  // where it was read. Without a pitch trend there is no Pitch to switch to.
  const tempoLine = tempoTrend(take.measures, take.targetBpm, take.tempoBeatUnit, take.tolerance);
  const pitchLine = takePitchTrend(take.measures, take.intonation);
  const showingPitch = view === 'pitch' && pitchLine !== null;
  // Bars with a note heard as another or an entrance after a miscounted rest:
  // a dot under each on the chart; the bar's card says what it was.
  const mistakes = mistakeBars(take.wrongNotes, take.restEntries);
  // Which written notes ran sharp or flat, under the pitch graph
  // (`lib/verdict/pitchByNote.ts`); a tapped one marks its bars instead.
  const noteMarks = showingPitch ? takeNoteMarks(take.intonation) : [];
  const tappedNote = noteMarks.find((m) => m.midi === note) ?? null;
  const marked = tappedNote ? new Set(tappedNote.bars) : mistakes;
  // The bars the verdict is about, which the main button practises.
  const passage = take.lowConfidence ? null : headlinePassage(take.headline);
  const recordAgain = () => navigation.replace('Record', { pieceId: take.pieceId });
  // The passage around the bar the musician tapped, in whichever reading the
  // chart is showing; nothing until they tap (`lib/verdict/barPassage.ts`).
  const tempoSpan =
    selected !== null && !showingPitch
      ? tempoPassageAt(take.measures, selected, take.targetBpm, take.tempoBeatUnit, take.tolerance)
      : null;
  const pitchSpan =
    selected !== null && showingPitch && take.intonation
      ? pitchPassageAt(take.measures, selected, take.intonation)
      : null;
  const span = tempoSpan ?? pitchSpan;
  // Shaded before any tap: the passage the verdict found, so the question and
  // the button that name it point at something on the graph.
  const shaded = span ?? (showingPitch ? null : passage);
  const spanLine = tempoSpan
    ? tempoPassageLine(tempoSpan)
    : pitchSpan
      ? pitchPassageLine(pitchSpan)
      : null;
  // What else went wrong inside it, said for the bar it happened in.
  const spanMistakes = span ? mistakesInPassage(take.wrongNotes, take.restEntries, span) : [];
  // The one question: about the passage the verdict found, or about the
  // whole take when it found none. Only over bars the app made a claim about.
  const askedBars = take.measures.filter(
    (m) => canCorrect(m) && (!passage || (m.measure >= passage.from && m.measure <= passage.to)),
  );
  const askedReading: UserVerdict =
    take.direction === 'rush' ? 'rushing' : take.direction === 'drag' ? 'dragging' : 'on_tempo';

  /*
    **The redesign's verdict, cut down** (the owner, 2026-09-29: "way too
    wordy and hard to read", and then circling what was still under the
    title). The verdict as a title that fits one line; the recording; one
    chart of every bar, tempo or pitch, with a dot under any bar holding a
    wrong note or a miscounted rest; the tapped bar opened in a card
    underneath; and the passage the verdict found as the button. It had grown to 118 words, three
    charts of the same bars, two colour keys and nine ruled lines — see
    `DECISIONS.md`, 2026-09-29.

    It replaced a list of one row per measure, which on a real piece was
    forty rows to scroll for the three that mattered. The chart opens on the
    measure most worth practising (`openingMeasure`).

    One control at the top the prototype does not draw: "‹ Back to the piece".
    A verdict opened from a piece's history in the home-screen app has no
    browser Back and no tab bar, and "Record again" is not the way out of it.
  */
  return (
    <ScreenContainer
      footer={
        /*
          **The passage the verdict found, not the whole piece again** (the
          owner's choice, 2026-09-29). The screen names bars 5–8 and its only
          button used to record everything from bar 1. "Record again" stays,
          quieter, under it — and is the only action when the verdict names no
          bars.
        */
        passage ? (
          <View>
            <PrimaryButton
              label={practiceLabel(passage)}
              onPress={() =>
                navigation.replace('Record', { pieceId: take.pieceId, startAt: passage.from })
              }
            />
            <Pressable
              onPress={recordAgain}
              accessibilityRole="button"
              style={({ pressed }) => [styles.quiet, pressed && styles.quietPressed]}
            >
              <Text variant="metadata" color="textTertiary">
                Record again
              </Text>
            </Pressable>
          </View>
        ) : (
          <PrimaryButton label="Record again" onPress={recordAgain} />
        )
      }
    >
      <BackLink
        label={fromTakes ? 'Back to your takes' : 'Back to the piece'}
        onPress={() =>
          fromTakes
            ? navigation.popTo('PieceTakes', { pieceId: take.pieceId })
            : navigation.popTo('PieceDetail', { pieceId: take.pieceId })
        }
      />
      <Text variant="screenTitle" accessibilityRole="header" style={styles.title}>
        {take.lowConfidence ? 'Timing is uncertain' : formatTakeVerdict(take.measures, take.direction)}
      </Text>
      {/*
        **Nothing under the title but the chart** (the owner, 2026-09-29,
        circling the two lines that were here on a phone). "Bars 5–8 at 104,
        not 96 BPM" said the title again in numbers — the chart shows which
        bars, the card their tempo, and the button names them — and "1 note
        missed · 1 wrong note, bar 6" was a list to read before the picture.
        A wrong note or a miscounted rest is now a dot under its bar.

        A take too hard to hear keeps its line: it is the only thing that
        says what to do about it.
      */}
      {take.lowConfidence ? (
        <Text variant="body" color="textSecondary" style={styles.headline}>
          Hard to hear. Try a quieter room, closer to the mic.
        </Text>
      ) : null}

      {take.recordingAvailable ? (
        <View style={styles.playback}>
          <TakePlayback analysisId={take.id} />
        </View>
      ) : null}

      {/*
        **One graph, and a trend rather than bars** (the owner, 2026-09-29:
        "the bar by bar measurement in general doesn't make sense … like a
        graph … to show the trend"). The take's tempo as a line across the
        band around the target, ink inside it and gold or red outside; pitch
        is the same picture, behind a switch rather than in a chart of its
        own. An older result saved without bar tempi has no line to draw and
        keeps the bars it was drawn with.
      */}
      {pitchLine ? (
        <SegmentedControl
          label="Graph"
          options={[
            { value: 'tempo', label: 'Tempo' },
            { value: 'pitch', label: 'Pitch' },
          ]}
          value={showingPitch ? 'pitch' : 'tempo'}
          onChange={(next) => {
            setNote(null);
            setView(next);
          }}
          style={styles.switch}
        />
      ) : null}
      <View style={pitchLine ? styles.chartUnderSwitch : styles.chart}>
        {showingPitch && pitchLine ? (
          <TrendChart
            data={pitchLine}
            measures={take.measures}
            selected={selected}
            onSelect={(bar) => {
              setNote(null);
              setSelected(bar);
            }}
            span={span}
            marked={marked}
            ends={{ up: 'sharp', down: 'flat' }}
            name="Pitch in bar"
            describe={(m) =>
              m.pitchCents == null || !take.intonation
                ? 'Not read'
                : pitchWord(m.pitchCents, take.intonation)
            }
          />
        ) : tempoLine ? (
          <TrendChart
            data={tempoLine}
            measures={take.measures}
            selected={selected}
            onSelect={setSelected}
            span={shaded}
            marked={marked}
            ends={{ up: 'faster', down: 'slower' }}
            name="Bar"
            describe={(m) =>
              barTempo(m, take.targetBpm, take.tempoBeatUnit, take.tolerance)?.spoken ??
              readMeasure(m).label
            }
          />
        ) : (
          <MeasureBars
            measures={take.measures}
            selected={selected}
            onSelect={setSelected}
            span={span}
            targetBpm={take.targetBpm}
            tempoBeatUnit={take.tempoBeatUnit}
            tolerance={take.tolerance}
            marked={marked}
            ends={{ up: 'ahead', down: 'behind' }}
          />
        )}
      </View>

      {/*
        **The passage, in one line, when a bar is tapped** (2026-09-29) — no
        card open on a bar nobody chose. "Bars 5–8 · about 104, aiming for
        96": a passage and a round figure, which is what a musician practises
        and as precise as a few bars' timing honestly is.
      */}
      {spanLine ? (
        <View style={styles.span}>
          <Text variant="body">{spanLine}</Text>
          {spanMistakes.map((line) => (
            <Text key={line} variant="metadataSmall" color="textSecondary" style={styles.spanMistake}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {/*
        **Which notes, under which bars** (the owner, 2026-09-30, "Result +
        Insights"): the take's written notes low to high, each where it sat
        against the player's tuning. One line names the notes that stand out;
        a tapped note says itself there instead and marks its bars on the
        graph's rail above.
      */}
      {noteMarks.length > 0 && take.intonation ? (
        <View style={styles.notes}>
          <Text variant="body" style={styles.notesLine}>
            {tappedNote ? noteDetail(tappedNote) : notesLine(noteMarks, 'take')}
          </Text>
          <NoteRow
            marks={noteMarks}
            inTuneCents={take.intonation.inTuneCents}
            named={namedMarks(noteMarks).map((m) => m.midi)}
            selected={note}
            onSelect={(midi) => {
              setSelected(null);
              setNote(midi);
            }}
          />
        </View>
      ) : null}

      {askedBars.length > 0 ? (
        <View style={styles.question}>
          <CorrectionPrompt
            question={passage ? `How did ${barsLabel(passage).toLowerCase()} sound?` : 'How did that sound?'}
            appVerdict={askedReading}
            state={answer}
            onChoose={(choice) => answerFor(askedBars, choice, reading)}
            onChange={() => setAnswer({ kind: 'idle' })}
          />
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  /**
   * 31pt rather than the screen title's 36, so every verdict fits one line on
   * a phone with "You" in it (the owner, 2026-09-29): "You dragged in the
   * middle" is 332 of 342 points here, and broke as "…in the / middle" at 36.
   */
  title: {
    fontSize: 31,
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  headline: {
    marginTop: 10,
  },
  playback: {
    marginTop: spacing.xl,
  },
  switch: {
    marginTop: spacing['2xl'],
  },
  chart: {
    marginTop: spacing['2xl'],
  },
  chartUnderSwitch: {
    marginTop: spacing.xl,
  },
  span: {
    marginTop: spacing.lg,
  },
  notes: {
    marginTop: spacing['2xl'],
  },
  notesLine: {
    marginBottom: spacing.md,
  },
  spanMistake: {
    marginTop: spacing.xs,
  },
  question: {
    marginTop: spacing['2xl'],
  },
  /** "Record again" under the passage: quiet, and still a 44pt target. */
  quiet: {
    alignSelf: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  quietPressed: {
    opacity: 0.55,
  },
});
