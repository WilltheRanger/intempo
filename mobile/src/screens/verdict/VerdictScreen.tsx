import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Card,
  EmptyState,
  LoadingState,
  MetadataRow,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { takeSource } from '../../data/sources';
import type { TakeResult } from '../../data/types';
import { spacing } from '../../design';
import { formatTendency } from '../../lib/tempo';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { MeasureRow } from './MeasureRow';
import { TrendLine } from './TrendLine';

/**
 * What one take came back as.
 *
 * The order is the spec's: the verdict word first, then the sentence, then the
 * shape of the take, then the measure-by-measure detail for anyone who wants
 * it. Someone who reads only the top of this screen should already know what
 * happened.
 *
 * Nothing is encoded in colour. The spec reserves green, amber and red for
 * verdict UI, and they are not in the palette yet — the word and the bar carry
 * it, which is also what keeps the screen readable to the ~8% of men with a
 * red-green deficiency the verdict hues map almost exactly onto.
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
        <LoadingState />
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
        title={formatTendency(take.verdict)}
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
          `Target ${take.targetBpm} BPM`,
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
        The axis here is vertical, unlike the bars elsewhere: the rule is the
        target tempo and the line rides above or below it. Labelling it left
        and right would describe a chart this isn't.
      */}
      <Card>
        <View>
          <TrendLine
            trend={take.trend}
            accessibilityLabel={`Tempo drift across ${take.measures.length} measures`}
          />
          <Text
            variant="metadataSmall"
            color="textTertiary"
            style={styles.axisTop}
          >
            Ahead
          </Text>
          <Text
            variant="metadataSmall"
            color="textTertiary"
            style={styles.axisBottom}
          >
            Behind
          </Text>
        </View>
        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.axisNote}
        >
          The rule is the target tempo. The take starts on the left.
        </Text>
      </Card>

      <SectionHeader label="Measure by measure" style={styles.section} />
      <Card padded={false}>
        <View style={styles.rows}>
          {take.measures.map((measure, index) => (
            <MeasureRow
              key={measure.measure}
              measure={measure}
              revealed={revealed === measure.measure}
              onToggle={() =>
                setRevealed((current) =>
                  current === measure.measure ? null : measure.measure,
                )
              }
              divided={index > 0}
            />
          ))}
        </View>
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
  axisTop: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  axisBottom: {
    position: 'absolute',
    bottom: 0,
    right: 0,
  },
  axisNote: {
    marginTop: spacing.md,
  },
  rows: {
    paddingHorizontal: spacing.lg,
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
