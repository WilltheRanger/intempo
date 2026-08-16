import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { FileMusic, Layers } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SheetOptionRow } from '../../components/overlays/SheetOptionRow';
import { TransportControls } from '../../components/playback/TransportControls';
import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import {
  Card,
  EmptyState,
  LoadingState,
  MetadataRow,
  PageHeader,
  PrimaryButton,
  ProgressBar,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { usePiece } from '../../data/hooks/usePieces';
import { MOCK_MEASURE_COUNT } from '../../data/sources/pieceMock';
import { spacing } from '../../design';
import { formatLastPracticed, formatProgressPercent } from '../../lib/format';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';

/** Height of the score strip across the top of the score card. */
const BANNER_HEIGHT = 88;

const MOCK_MS_PER_MEASURE = 550;

/**
 * A saved piece.
 *
 * Shell only: playback moves a position readout and makes no sound, and the
 * digital score and original pages are reachable but not yet backed by
 * anything for pieces that predate the scan flow.
 */
export function PieceDetailScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'PieceDetail'>>();
  const { data: piece, isPending, isError } = usePiece(params.pieceId);

  const [measure, setMeasure] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const timer = setTimeout(() => {
      setMeasure((current) => (current >= MOCK_MEASURE_COUNT ? 1 : current + 1));
    }, MOCK_MS_PER_MEASURE);
    return () => clearTimeout(timer);
  }, [isPlaying, measure]);

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
          title="Couldn't open this piece"
          description="It may have been removed from your library."
          actionLabel="Back"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  const started = piece.progress !== null && piece.progress > 0;

  return (
    <ScreenContainer>
      <PageHeader
        title={piece.title}
        onBack={() => navigation.goBack()}
        backLabel="Back to library"
      />

      {piece.composer ? (
        <Text variant="composer" color="textSecondary">
          {piece.composer}
        </Text>
      ) : null}
      {piece.movement ? (
        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.movement}
        >
          {piece.movement}
        </Text>
      ) : null}

      <Card emphasis padded={false} style={styles.scoreCard}>
        <ScoreThumbnail
          source={piece.thumbnail}
          radius={0}
          style={styles.banner}
        />

        <View style={styles.scoreBody}>
          <ProgressBar
            value={piece.progress}
            accessibilityLabel={`Progress through ${piece.title}`}
          />
          <MetadataRow
            variant="metadataSmall"
            items={[
              formatProgressPercent(piece.progress),
              formatLastPracticed(piece.lastPracticedAt),
            ]}
            style={styles.scoreMeta}
          />

          <PrimaryButton
            label={started ? 'Continue practice' : 'Start practice'}
            onPress={() => navigation.navigate('Record', { pieceId: piece.id })}
            style={styles.practice}
          />
        </View>
      </Card>

      <Card style={styles.playbackCard}>
        <Text variant="sectionLabel" color="textSecondary">
          Playback
        </Text>

        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.position}
        >
          Measure {measure} of {MOCK_MEASURE_COUNT}
        </Text>

        <View style={styles.transport}>
          <TransportControls
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((playing) => !playing)}
            onPrevious={() => setMeasure((m) => Math.max(1, m - 1))}
            onNext={() => setMeasure((m) => Math.min(MOCK_MEASURE_COUNT, m + 1))}
            previousDisabled={measure === 1}
            nextDisabled={measure >= MOCK_MEASURE_COUNT}
          />
        </View>
      </Card>

      <Card padded={false} style={styles.accessCard}>
        <View style={styles.accessRows}>
          <SheetOptionRow
            icon={FileMusic}
            label="Digital score"
            description="The transcribed notation."
            divided={false}
            onPress={() => navigation.navigate('TranscriptionReview')}
          />
          <SheetOptionRow
            icon={Layers}
            label="Original pages"
            description="The photos this piece was transcribed from."
            onPress={() => navigation.navigate('CapturedPages')}
          />
        </View>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  movement: {
    marginTop: spacing.xs,
  },
  scoreCard: {
    marginTop: spacing.xl,
  },
  banner: {
    width: '100%',
    height: BANNER_HEIGHT,
  },
  scoreBody: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  scoreMeta: {
    marginTop: spacing.sm,
  },
  practice: {
    marginTop: spacing.lg,
  },
  playbackCard: {
    marginTop: spacing.md,
  },
  position: {
    marginTop: spacing.md,
  },
  transport: {
    marginTop: spacing.md,
  },
  accessCard: {
    marginTop: spacing.md,
  },
  accessRows: {
    paddingHorizontal: spacing.lg,
  },
});
