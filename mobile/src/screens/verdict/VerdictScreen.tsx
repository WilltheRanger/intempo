import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Card,
  EmptyState,
  MetadataRow,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { FadeIn } from '../../components/motion';
import { VerdictSkeleton } from '../../components/skeletons';
import { takeSource } from '../../data/sources';
import type { TakeResult } from '../../data/types';
import { spacing } from '../../design';
import { formatTakeVerdict, formatTempo } from '../../lib/tempo';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { MEASURE_COLUMNS, MeasureRow } from './MeasureRow';
import { TrendLine } from './TrendLine';

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
          title="Couldn't load this take"
          description="It may have been removed, or the analysis never finished."
          actionLabel="Back"
          onActionPress={() => navigation.goBack()}
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
        <PageHeader
          eyebrow={take.pieceTitle}
          title="This take didn't get analysed"
          onBack={() => navigation.goBack()}
          backLabel="Back to the piece"
        />
        <Text variant="body" color="textSecondary">
          {take.failure.recoverable
            ? 'Something went wrong on our side, not with your playing. Recording it again usually works.'
            : "We couldn't process this recording. Your playing wasn't the problem — record it again when you have a moment."}
        </Text>
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
        <PageHeader
          eyebrow={take.pieceTitle}
          title="Nothing to measure"
          onBack={() => navigation.goBack()}
          backLabel="Back to the piece"
        />
        <Text variant="body" color="textSecondary">
          {take.headline}
        </Text>
      </ScreenContainer>
    );
  }

  // The chart's x axis, so the ends of the line name measures that can be
  // found in the list below it.
  const firstMeasure = take.measures[0]?.measure ?? 1;
  const lastMeasure =
    take.measures[take.measures.length - 1]?.measure ?? take.measures.length;

  return (
    <ScreenContainer
      footer={
        <View style={styles.actions}>
          <PrimaryButton
            label="Record again"
            onPress={() =>
              navigation.replace('Record', { pieceId: take.pieceId })
            }
          />
          <SecondaryButton
            label="Back to the piece"
            onPress={() =>
              navigation.replace('PieceDetail', { pieceId: take.pieceId })
            }
            style={styles.secondary}
          />
        </View>
      }
    >
      <PageHeader
        eyebrow={take.pieceTitle}
        title={formatTakeVerdict(take.measures)}
        onBack={() => navigation.goBack()}
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
      <Card>
        <TrendLine
          trend={take.trend}
          tolerance={take.tolerance}
          firstMeasure={firstMeasure}
          lastMeasure={lastMeasure}
          accessibilityLabel={`Tempo drift across ${take.measures.length} measures`}
        />
      </Card>

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
      {/* No wrapper padding: each row owns its gutter so the selected one can
          tint edge to edge. */}
      <Card padded={false}>
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
      </Card>

      <Text variant="metadataSmall" color="textTertiary" style={styles.tip}>
        Tap a measure for its timing.
      </Text>
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
  actions: {
    gap: spacing.md,
  },
  secondary: {
    marginTop: 0,
  },
});
