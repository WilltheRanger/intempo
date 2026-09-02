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
import type { TakeResult } from '../../data/types';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { formatTakeVerdict, formatTempo } from '../../lib/tempo';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import {
  describeTrendRange,
  readMeasure,
  timedMeasureRange,
} from '../../lib/verdict/measureReading';
import { MEASURE_COLUMNS, MeasureRow } from './MeasureRow';
import { TrendLine } from './TrendLine';
import { TakePlayback } from './TakePlayback';

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

  const {
    data: take,
    isPending,
    isError,
  } = useQuery<TakeResult | null>({
    queryKey: ['take', params.analysisId],
    queryFn: () => takeSource.getTake(params.analysisId),
  });

  /**
   * The piece is only known once the take has loaded, and these branches run
   * when it has not or when it failed. `Library` is the honest fallback there:
   * the success path below navigates to the piece by name, which is what a
   * verdict's back control should do when there is a piece to name.
   */
  const goBack = useGoBack(
    take ? { route: 'PieceDetail', params: { pieceId: take.pieceId } } : { tab: 'Library' },
  );

  if (isPending) {
    return (
      <ScreenContainer>
        <VerdictSkeleton />
      </ScreenContainer>
    );
  }

  if (isError || !take) {
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
          title="This take didn't get analysed"
          description={
            take.failure.recoverable
              ? 'Something went wrong on our side, not with your playing. Recording it again usually works.'
              : "We couldn't process this recording. Your playing wasn't the problem — record it again when you have a moment."
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
        <EmptyState fill title="Nothing to measure" description={take.headline} />
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

      <MetadataRow
        variant="metadataSmall"
        items={[
          `Target ${formatTempo(take.targetBpm, take.tempoBeatUnit)}`,
          measureLabel(take.measures.length),
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
              divided={index > 0}
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
          Tap a measure for its timing.
        </Text>
      ) : null}
    </ScreenContainer>
  );
}

function measureLabel(count: number): string {
  return count === 1 ? '1 measure' : `${count} measures`;
}

function noteLabel(count: number): string {
  return count === 1 ? '1 note missed' : `${count} notes missed`;
}

const styles = StyleSheet.create({
  headline: {
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
