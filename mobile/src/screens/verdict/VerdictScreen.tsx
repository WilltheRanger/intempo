import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useGoBack } from '../../navigation/useGoBack';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  BackLink,
  EmptyState,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
  RuledHeading,
} from '../../components/primitives';
import { VerdictSkeleton } from '../../components/skeletons';
import { takeSource } from '../../data/sources';
import type { MeasureVerdict, TakeResult, UserVerdict } from '../../data/types';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { formatTakeVerdict, formatTempo } from '../../lib/tempo';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import {
  describeTrendRange,
  timedMeasureRange,
} from '../../lib/verdict/measureReading';
import { openingMeasure } from '../../lib/verdict/measureChart';
import { passageLabel } from '../../lib/verdict/passage';
import {
  failureTitle,
  intakeRefusal,
  nothingUsableTitle,
} from '../../lib/verdict/failureTitle';
import {
  appVerdictFor,
  canCorrect,
  correctionAcknowledgement,
} from '../../lib/verdict/correction';
import { useSubmitCorrection } from '../../data/hooks/useCorrections';
import { CorrectionPrompt, type CorrectionState } from './CorrectionPrompt';
import { MeasureBars } from './MeasureBars';
import { MeasureCard } from './MeasureCard';
import { TrendLine } from './TrendLine';
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
  /** The measure the chart has open; null until chosen, meaning `openingMeasure`. */
  const [selected, setSelected] = useState<number | null>(null);

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

  function correct(measure: MeasureVerdict, choice: UserVerdict) {
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
            app_verdict: appVerdictFor(measure),
            user_verdict: choice,
          },
        ],
      },
      {
        onSuccess: () =>
          setCorrections((current) => ({
            ...current,
            [measure.measure]: {
              kind: 'sent',
              message: correctionAcknowledgement(choice),
            },
          })),
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

  // The chart's x axis, so the ends of the line name measures that can be
  // found in the list below it — and specifically the measures the line
  // *reaches*. `trend` drops untimed and slur-interior notes, so labelling
  // this from the whole take captioned the ends with bars the line stops
  // short of. See `timedMeasureRange`.
  const covered = timedMeasureRange(take.measures);
  const firstMeasure = covered?.first ?? take.measures[0]?.measure ?? 1;
  const lastMeasure =
    covered?.last ??
    take.measures[take.measures.length - 1]?.measure ??
    take.measures.length;
  const opening = openingMeasure(take.measures);
  const chosen = take.measures.find((m) => m.measure === (selected ?? opening)) ?? null;

  /*
    **The redesign's verdict** (`redesign/Verdict.dc.html`, 2026-09-23): the
    piece, the verdict as the title, one sentence, three facts on a ruled row,
    the take as a line, every measure as one chart, and the selected measure
    opened in a card underneath.

    It replaces a list of one row per measure, which on a real piece was forty
    rows to scroll for the three that mattered. The chart opens on the measure
    most worth practising (`openingMeasure`), which is what the "Try bar 7
    again" sentence used to point at in words.

    One control at the top the prototype does not draw: "‹ Back to the piece".
    A verdict opened from a piece's history in the home-screen app has no
    browser Back and no tab bar, and "Record again" is not the way out of it.
  */
  return (
    <ScreenContainer
      footer={
        <PrimaryButton
          label="Record again"
          onPress={() => navigation.replace('Record', { pieceId: take.pieceId })}
        />
      }
    >
      <BackLink
        label="Back to the piece"
        onPress={() => navigation.navigate('PieceDetail', { pieceId: take.pieceId })}
      />
      <Text variant="screenTitle" accessibilityRole="header">
        {take.lowConfidence ? 'Timing is uncertain' : formatTakeVerdict(take.measures)}
      </Text>

      <Text variant="body" color="textSecondary" style={styles.headline}>
        {take.lowConfidence
          ? 'Hard to hear. Try a quieter room, closer to the mic.'
          : take.headline}
      </Text>
      {/*
        What the verdict cannot say: the tempo actually played, a take that
        sped up, or the note value that behaves differently from the rest —
        ranked per take in `services/insights.lead_finding`, and only when
        there is one. Body weight, a continuation of the sentence above.
      */}
      {take.finding ? (
        <Text variant="body" style={styles.finding}>
          {take.finding.text}
        </Text>
      ) : null}

      {/* Three facts, ruled above and below, in the redesign's columns. */}
      <View style={styles.facts}>
        <Fact label="Target" value={formatTempo(take.targetBpm, take.tempoBeatUnit)} />
        <Fact label="Passage" value={passageLabel(take.measures) ?? '—'} />
        <Fact
          label="Missed"
          value={take.missedNotes > 0 ? noteLabel(take.missedNotes) : 'None'}
        />
      </View>

      {take.recordingAvailable ? (
        <View style={styles.playback}>
          <TakePlayback analysisId={take.id} />
        </View>
      ) : null}

      <RuledHeading label="Across the take" style={styles.ruled} />
      {/*
        No sentence under this one. The chart names its own axes — Target on
        the rule, ahead and behind either side of it — so prose explaining it
        would only repeat what it already says.
      */}
      <TrendLine
        trend={take.trend}
        tolerance={take.tolerance}
        firstMeasure={firstMeasure}
        lastMeasure={lastMeasure}
        accessibilityLabel={describeTrendRange(firstMeasure, lastMeasure)}
      />

      <RuledHeading label="Bar by bar" style={styles.ruled} />
      <MeasureBars
        measures={take.measures}
        selected={chosen?.measure ?? null}
        onSelect={setSelected}
      />

      {chosen ? (
        <View style={styles.card}>
          <MeasureCard
            measure={chosen}
            tolerance={take.tolerance}
            correction={
              /*
                Only where the app made a claim about the playing. A bar under
                a `rit.`, a held fermata or an ornament was never judged, so
                there is nothing to agree or disagree with.
              */
              canCorrect(chosen) ? (
                <CorrectionPrompt
                  appVerdict={appVerdictFor(chosen)}
                  state={corrections[chosen.measure] ?? { kind: 'idle' }}
                  onChoose={(choice) => correct(chosen, choice)}
                />
              ) : null
            }
          />
        </View>
      ) : null}
    </ScreenContainer>
  );
}

/** One of the three facts under the verdict. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text variant="eyebrow" color="textTertiary" style={styles.factLabel}>
        {label}
      </Text>
      <Text variant="body" style={styles.factValue}>
        {value}
      </Text>
    </View>
  );
}

/**
 * A section's name over a rule — the redesign's section heading: sentence
 * case at 13pt rather than a tracked capital eyebrow, because on this screen
 * the sections are read in order, not scanned for.
 */
function noteLabel(count: number): string {
  return count === 1 ? '1 note missed' : `${count} notes missed`;
}

const styles = StyleSheet.create({
  headline: {
    marginTop: 10,
  },
  finding: {
    marginTop: spacing.sm,
  },
  facts: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: BORDER_WIDTH,
    borderBottomWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  fact: {
    flex: 1,
    minWidth: 0,
  },
  factLabel: {
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  factValue: {
    marginTop: spacing.xs,
    fontSize: 15,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
  playback: {
    marginTop: spacing.lg,
  },
  ruled: {
    marginTop: 22,
    marginBottom: spacing.lg,
  },
  card: {
    marginTop: spacing.xl,
  },
});
