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
import { openingMeasure } from '../../lib/verdict/measureChart';
import { appVerdictForBar, tempoChartBars } from '../../lib/verdict/barTempo';
import { pitchChartBars, pitchWord } from '../../lib/verdict/intonation';
import { headlinePassage, practiceLabel } from '../../lib/verdict/passage';
import { mistakeBars, restEntriesInBar, wrongNotesInBar } from '../../lib/verdict/mistakes';
import {
  failureTitle,
  intakeRefusal,
  nothingUsableTitle,
} from '../../lib/verdict/failureTitle';
import { appVerdictFor, canCorrect } from '../../lib/verdict/correction';
import { success } from '../../lib/haptics';
import { useSubmitCorrection } from '../../data/hooks/useCorrections';
import { CorrectionPrompt, type CorrectionState } from './CorrectionPrompt';
import { MeasureBars } from './MeasureBars';
import { MeasureCard } from './MeasureCard';
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

  /*
    Where each measure's correction has got to, keyed by measure number.

    **Kept here rather than in the row** so it survives collapsing and
    reopening a row — someone who taps away and comes back should see that
    they already answered, not be asked again. Not persisted beyond the
    screen: the server appends rather than replaces, so a second answer is a
    second opinion and both are data, but re-asking within one sitting reads
    as the app having forgotten.
  */
  const [corrections, setCorrections] = useState<Record<number, CorrectionState>>(
    {},
  );
  const submitCorrection = useSubmitCorrection();

  function correct(measure: MeasureVerdict, choice: UserVerdict, appVerdict: UserVerdict) {
    setCorrections((current) => ({
      ...current,
      [measure.measure]: { kind: 'sending', choice },
    }));
    submitCorrection.mutate(
      {
        analysisId: params.analysisId,
        corrections: [
          {
            measure_number: measure.measure,
            // Sent as the app's own word for it, so the pair is stored
            // together — the dataset exists to compare the two, and storing
            // only the correction loses what it was correcting.
            // What the card showed — the bar's tempo, where it has one
            // (`appVerdictForBar`).
            app_verdict: appVerdict,
            user_verdict: choice,
          },
        ],
      },
      {
        onSuccess: () => {
          // Felt as well as seen: the answer arrived.
          success();
          setCorrections((current) => ({
            ...current,
            [measure.measure]: { kind: 'sent', choice },
          }));
        },
        onError: (error: unknown) =>
          setCorrections((current) => ({
            ...current,
            [measure.measure]: {
              kind: 'failed',
              /*
                The error's own words, matching `ProfileScreen`'s convention
                for the same shape of write. **Not `describeLoadError`**: that
                exists for a screen that could not *load*, and its fallback is
                "Check your connection and try again" — which replaced the
                hook's own "Sending feedback needs the backend. This build is
                running on sample data." with a guess that is both wrong and
                unactionable. That is the exact substitution `describeError.ts`
                was written to stop, and it reappeared one caller over.
              */
              message:
                error instanceof Error
                  ? error.message
                  : 'Couldn’t send. Try again.',
            },
          })),
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
          description={
            refused
              ? refused.description
              : take.failure.recoverable
                ? 'Not your playing. Try again.'
                : 'Not your playing. Record it again.'
          }
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
          description={take.headline}
        />
        {take.recordingAvailable ? (
          <TakePlayback analysisId={take.id} />
        ) : null}
      </ScreenContainer>
    );
  }

  const opening = openingMeasure(take.measures);
  const chosen = take.measures.find((m) => m.measure === (selected ?? opening)) ?? null;
  const chosenAppVerdict = chosen
    ? appVerdictForBar(chosen, take.targetBpm, take.tempoBeatUnit, take.tolerance)
    : null;
  // Each bar's pitch against the player's own tuning, where the take carries
  // it (`lib/verdict/intonation.ts`); without it there is no Pitch to switch to.
  const pitchBars = pitchChartBars(take.measures, take.intonation);
  const showingPitch = view === 'pitch' && pitchBars !== null;
  // What up and down mean on the chart. An older result without bar tempi
  // draws how far ahead or behind the beat each bar sat, not its tempo.
  const tempoEnds = tempoChartBars(take.measures, take.targetBpm, take.tempoBeatUnit, take.tolerance)
    ? { up: 'faster', down: 'slower' }
    : { up: 'ahead', down: 'behind' };
  // Bars with a note heard as another or an entrance after a miscounted rest:
  // a dot under each on the chart; the bar's card says what it was.
  const marked = mistakeBars(take.wrongNotes, take.restEntries);
  // The bars the verdict is about, which the main button practises.
  const passage = take.lowConfidence ? null : headlinePassage(take.headline);
  const recordAgain = () => navigation.replace('Record', { pieceId: take.pieceId });

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
      <Text variant="screenTitle" accessibilityRole="header">
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
        **One chart** (2026-09-29). There were three of the same bars: the
        take as a tempo line, the bars as a chart, and pitch as a second chart,
        each with its heading, its "Bar 1 … 13" and, for two of them, a colour
        key. The line said nothing the bars did not, and was the one you could
        not tap. Pitch is the same bars read another way, so it is a switch on
        this chart rather than a chart of its own (the owner's choice). The
        colours are explained by the bar you tap, not by a key.
      */}
      {pitchBars ? (
        <SegmentedControl
          label="Chart"
          options={[
            { value: 'tempo', label: 'Tempo' },
            { value: 'pitch', label: 'Pitch' },
          ]}
          value={showingPitch ? 'pitch' : 'tempo'}
          onChange={setView}
          style={styles.switch}
        />
      ) : null}
      <View style={pitchBars ? styles.chartUnderSwitch : styles.chart}>
        {showingPitch && pitchBars ? (
          <MeasureBars
            measures={take.measures}
            selected={chosen?.measure ?? null}
            onSelect={setSelected}
            targetBpm={take.targetBpm}
            tempoBeatUnit={take.tempoBeatUnit}
            tolerance={take.tolerance}
            chart={pitchBars}
            marked={marked}
            name="Pitch in bar"
            describe={(m) =>
              m.pitchCents == null || !take.intonation
                ? 'Not read'
                : pitchWord(m.pitchCents, take.intonation)
            }
            ends={{ up: 'sharp', down: 'flat' }}
          />
        ) : (
          <MeasureBars
            measures={take.measures}
            selected={chosen?.measure ?? null}
            onSelect={setSelected}
            targetBpm={take.targetBpm}
            tempoBeatUnit={take.tempoBeatUnit}
            tolerance={take.tolerance}
            marked={marked}
            ends={tempoEnds}
          />
        )}
      </View>

      {chosen ? (
        <View style={styles.card}>
          <MeasureCard
            measure={chosen}
            intonation={take.intonation}
            wrongNotes={wrongNotesInBar(take.wrongNotes, chosen.measure)}
            restEntries={restEntriesInBar(take.restEntries, chosen.measure)}
            tolerance={take.tolerance}
            targetBpm={take.targetBpm}
            tempoBeatUnit={take.tempoBeatUnit}
            correction={
              /*
                Only where the app made a claim about the playing. A bar under
                a `rit.`, a held fermata or an ornament was never judged, so
                there is nothing to agree or disagree with.
              */
              canCorrect(chosen) ? (
                <CorrectionPrompt
                  appVerdict={chosenAppVerdict ?? appVerdictFor(chosen)}
                  state={corrections[chosen.measure] ?? { kind: 'idle' }}
                  onChoose={(choice) =>
                    correct(chosen, choice, chosenAppVerdict ?? appVerdictFor(chosen))
                  }
                  onChange={() =>
                    setCorrections((current) => ({
                      ...current,
                      [chosen.measure]: { kind: 'idle' },
                    }))
                  }
                />
              ) : null
            }
          />
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
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
  card: {
    marginTop: spacing.xl,
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
