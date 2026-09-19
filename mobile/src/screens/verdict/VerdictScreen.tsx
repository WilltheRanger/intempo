import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useGoBack } from '../../navigation/useGoBack';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  EmptyState,
  MetadataRow,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { FadeIn } from '../../components/motion';
import { VerdictSkeleton } from '../../components/skeletons';
import { takeSource } from '../../data/sources';
import type { MeasureVerdict, TakeResult, UserVerdict } from '../../data/types';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { formatTakeVerdict, formatTempo } from '../../lib/tempo';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import {
  describeTrendRange,
  readMeasure,
  timedMeasureRange,
} from '../../lib/verdict/measureReading';
import { passageLabel } from '../../lib/verdict/passage';
import { failureTitle, nothingUsableTitle } from '../../lib/verdict/failureTitle';
import {
  appVerdictFor,
  canCorrect,
  correctionAcknowledgement,
} from '../../lib/verdict/correction';
import { useSubmitCorrection } from '../../data/hooks/useCorrections';
import { CorrectionPrompt, type CorrectionState } from './CorrectionPrompt';
import { MEASURE_COLUMNS, MeasureRow } from './MeasureRow';
import { TrendLine } from './TrendLine';
import { TakePlayback } from './TakePlayback';
import { loadStateFor } from '../../lib/loadState';
import { rowDivided } from '../../components/rowMetrics';

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
  const [revealed, setRevealed] = useState<number | null>(null);

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
                  : 'That feedback could not be sent. Try again.',
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
          description="It may have been removed, or the analysis never finished."
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
    return (
      <ScreenContainer
        footer={
          <PrimaryButton
            label={take.failure.recoverable ? 'Try again' : 'Record again'}
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
          eyebrow={take.pieceTitle}
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
          title={failureTitle(take.failure)}
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
            take.failure.recoverable
              ? "Your playing wasn't the problem. Recording it again usually works."
              : "Your playing wasn't the problem. Record it again when you have a moment."
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
          eyebrow={take.pieceTitle}
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

  return (
    /*
      **One action, not two.** "Back to the piece" was a full-width secondary
      button under the primary *and* the label on the chevron at the top — the
      same words twice, one of them saying what the other already offered. It
      cost about 65pt of a screen whose measure list was showing three rows of
      twelve, which is the part of this screen a musician actually works from.

      The two also went to different places under the same words: the chevron
      called `goBack()`, which after a take returns to the Record screen, while
      the button `replace`d with the piece. The chevron now does what it says.
    */
    <ScreenContainer
      footer={
        <PrimaryButton
          label="Record again"
          onPress={() => navigation.replace('Record', { pieceId: take.pieceId })}
        />
      }
    >
      <PageHeader
        eyebrow={take.pieceTitle}
        title={formatTakeVerdict(take.measures)}
        onBack={() => navigation.navigate('PieceDetail', { pieceId: take.pieceId })}
        backLabel="Back to the piece"
      />

      {/* The pipeline's own sentence — it knows which measures drifted. */}
      <Text variant="body" color="textSecondary" style={styles.headline}>
        {take.headline}
      </Text>

      {/*
        **One finding, and only when there is one.**

        The verdict says what happened to the beat. This says the thing the
        verdict cannot: the tempo actually played against the one that was
        set, a take that sped up rather than one that was merely fast, or the
        written note value that behaves differently from the rest — "your
        quarters are fine and your sixteenths run away", which is a thing to
        practise where "you rushed" is not.

        Which one appears is ranked per take rather than by a fixed order, in
        `services/insights.lead_finding`: a take whose real story is the
        sixteenths must not lead with a 2 BPM difference nobody would notice.

        **Null is the common case and is the design.** A musician who played
        at the tempo they set, evenly, has already been told so above; a
        second line restating it teaches them this part of the screen is
        furniture, and then the line that matters is not read either.

        Kept to `body` weight rather than given a heading, because §3 law 4
        allows the screen one focal point and that is the verdict title above.
        It reads as a continuation of the sentence before it.
      */}
      {take.finding ? (
        <Text variant="body" style={styles.finding}>
          {take.finding.text}
        </Text>
      ) : null}

      <MetadataRow
        variant="metadataSmall"
        items={[
          `Target ${formatTempo(take.targetBpm, take.tempoBeatUnit)}`,
          // **Which bars, when the take did not open the page.** Practising a
          // passage is the ordinary case — the pipeline matches a take against
          // the passage it covers — and this said "4 measures", which is true
          // and answers a question nobody asked: four measures of what, and
          // why does the list below start at bar 9? See `passage.ts`.
          passageLabel(take.measures),
          take.missedNotes > 0 ? noteLabel(take.missedNotes) : null,
        ]}
        style={styles.meta}
      />

      {take.recordingAvailable ? (
        <TakePlayback analysisId={take.id} />
      ) : null}

      {take.lowConfidence ? (
        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.caveat}
        >
          The recording was hard to follow, so treat this as a rough read.
          A quieter room or a closer microphone usually fixes it.
        </Text>
      ) : null}

      <SectionHeader label="Across the take" style={styles.section} />
      {/*
        No sentence under this one. The chart names its own axes — Target on
        the rule, ahead and behind either side of it, measure numbers at each
        end — so prose explaining it would only repeat what it already says.
      */}
      <View style={styles.chart}>
        <TrendLine
          trend={take.trend}
          tolerance={take.tolerance}
          firstMeasure={firstMeasure}
          lastMeasure={lastMeasure}
          // The same two numbers the axis prints — see `describeTrendRange`,
          // which lives beside `timedMeasureRange` because they had drifted.
          accessibilityLabel={describeTrendRange(firstMeasure, lastMeasure)}
        />
      </View>

      <SectionHeader label="Measure by measure" style={styles.section} />
      {/*
        Which way the bars point. Laid out on the row's own columns so the
        arrows sit over the bar rather than over the middle of the card.
      */}
      <View style={styles.legend}>
        <Text variant="metadataSmall" color="textTertiary" style={styles.legendLabel}>
          Behind ← Target → Ahead
        </Text>
      </View>
      {/*
        **Ruled rows on the page, not a card.** Twelve rows that already divide
        themselves with a hairline apiece do not need a box drawn round them
        (§3 law 3) — the same call as the library's own list and the piece
        screen's destinations. Each row owns its gutter, so a selected one still
        tints edge to edge.
      */}
      <View style={styles.measures}>
        {take.measures.map((measure, index) => (
          <FadeIn key={measure.measure} index={index}>
            <MeasureRow
              measure={measure}
              tolerance={take.tolerance}
              revealed={revealed === measure.measure}
              onToggle={() =>
                setRevealed((current) =>
                  current === measure.measure ? null : measure.measure,
                )
              }
              divided={rowDivided(index)}
              revealedExtra={
                /*
                  Only where the app made a claim about the playing. A bar
                  under a `rit.`, a held fermata or an ornament was never
                  judged, so there is nothing to agree or disagree with —
                  `canCorrect` is the row's own `revealsFigure`, deliberately,
                  rather than a second predicate free to drift from it.
                */
                canCorrect(measure) ? (
                  <CorrectionPrompt
                    appVerdict={appVerdictFor(measure)}
                    state={corrections[measure.measure] ?? { kind: 'idle' }}
                    onChoose={(choice) => correct(measure, choice)}
                  />
                ) : null
              }
            />
          </FadeIn>
        ))}
      </View>

      {/*
        Only when some measure has a figure behind it. A take that is entirely
        a `rit.`, or one bar of held chord, has no row that answers a tap — and
        an instruction for an interaction the screen does not offer is the same
        dead end as an empty state naming an action it has no route to.
      */}
      {take.measures.some((m) => readMeasure(m).revealsFigure) ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.tip}>
          Tap a measure for how far off the beat it was.
        </Text>
      ) : null}
    </ScreenContainer>
  );
}

function noteLabel(count: number): string {
  return count === 1 ? '1 note missed' : `${count} notes missed`;
}

const styles = StyleSheet.create({
  headline: {
    marginTop: spacing.sm,
  },
  finding: {
    // Tucked under the headline rather than spaced as a sibling: it is a
    // second sentence about the same take, not a new section.
    marginTop: spacing.sm,
  },
  meta: {
    marginTop: spacing.md,
  },
  caveat: {
    marginTop: spacing.lg,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  legend: {
    // The row's own geometry: number column, gap, bar, gap, verdict column.
    // Padding rather than spacer views, so the legend stays one line of text.
    paddingLeft:
      MEASURE_COLUMNS.gutter + MEASURE_COLUMNS.number + MEASURE_COLUMNS.gap,
    paddingRight:
      MEASURE_COLUMNS.gutter + MEASURE_COLUMNS.verdict + MEASURE_COLUMNS.gap,
    paddingBottom: spacing.sm,
  },
  legendLabel: {
    textAlign: 'center',
  },
  tip: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  /**
   * The chart, ruled rather than boxed.
   *
   * It was the last card on the screen and therefore the only white surface on
   * an ivory page, which gave the summary more weight than the twelve rows of
   * detail below it — the same data, and the part a musician works from. A rule
   * above and below marks it off as a figure without making it a panel (§3
   * laws 3 and 6).
   */
  chart: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: BORDER_WIDTH,
    borderBottomWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  measures: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
});
