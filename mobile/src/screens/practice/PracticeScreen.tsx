import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Minus, Plus, Repeat } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { NotationPlaceholder } from '../../components/pieces/NotationPlaceholder';
import { TransportControls } from '../../components/playback/TransportControls';
import {
  Card,
  EmptyState,
  IconButton,
  LoadingState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { usePiece } from '../../data/hooks/usePieces';
import {
  MOCK_DEFAULT_BPM,
  MOCK_MEASURE_COUNT,
  TEMPO_MAX,
  TEMPO_MIN,
  TEMPO_STEP,
} from '../../data/sources/pieceMock';
import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  spacing,
} from '../../design';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';

/**
 * Practice shell.
 *
 * Establishes the hierarchy the real practice screen will need — score,
 * transport, tempo, loop, session — without any of the machinery. Nothing
 * makes sound, nothing listens, nothing is recorded. The tempo control does
 * drive the marker's pace, so changing it visibly does something.
 */
export function PracticeScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Practice'>>();
  const { data: piece, isPending, isError } = usePiece(params.pieceId);

  const [measure, setMeasure] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(MOCK_DEFAULT_BPM);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  // The marker steps at the set tempo, so the control isn't inert.
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const timer = setTimeout(() => {
      setMeasure((current) =>
        current >= MOCK_MEASURE_COUNT ? 1 : current + 1,
      );
    }, 60_000 / bpm);
    return () => clearTimeout(timer);
  }, [bpm, isPlaying, measure]);

  // Session time accrues while practising, not while the screen merely sits open.
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const ticker = setInterval(
      () => setSessionSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => clearInterval(ticker);
  }, [isPlaying]);

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

  return (
    <ScreenContainer>
      <PageHeader eyebrow={piece.composer ?? undefined} title={piece.title} />

      <Card>
        <Text variant="sectionLabel" color="textSecondary">
          Score
        </Text>

        <View style={styles.notation}>
          <NotationPlaceholder
            measures={MOCK_MEASURE_COUNT}
            currentMeasure={measure}
          />
        </View>

        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.measure}
        >
          Measure {measure} of {MOCK_MEASURE_COUNT}
        </Text>
      </Card>

      <Card style={styles.controls}>
        <TransportControls
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying((playing) => !playing)}
          onPrevious={() => setMeasure((m) => Math.max(1, m - 1))}
          onNext={() =>
            setMeasure((m) => Math.min(MOCK_MEASURE_COUNT, m + 1))
          }
          previousDisabled={measure === 1}
          nextDisabled={measure >= MOCK_MEASURE_COUNT}
        />

        <View style={styles.settingRow}>
          <Text variant="button">Tempo</Text>
          <View style={styles.tempo}>
            <IconButton
              icon={Minus}
              label="Slower"
              onPress={() => setBpm((v) => Math.max(TEMPO_MIN, v - TEMPO_STEP))}
              disabled={bpm <= TEMPO_MIN}
            />
            <Text variant="button" style={styles.bpm}>
              {bpm}
            </Text>
            <IconButton
              icon={Plus}
              label="Faster"
              onPress={() => setBpm((v) => Math.min(TEMPO_MAX, v + TEMPO_STEP))}
              disabled={bpm >= TEMPO_MAX}
            />
          </View>
        </View>

        <View style={styles.settingRow}>
          <View style={styles.loopLabel}>
            <Repeat
              size={ICON_SIZE.md}
              strokeWidth={ICON_STROKE_WIDTH}
              color={colors.textPrimary}
            />
            <Text variant="button">Loop section</Text>
          </View>
          <Switch
            value={loopEnabled}
            onValueChange={setLoopEnabled}
            accessibilityLabel="Loop section"
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.surface}
            ios_backgroundColor={colors.border}
          />
        </View>
      </Card>

      <Text
        variant="metadataSmall"
        color="textTertiary"
        style={styles.session}
      >
        {/* No quarter-note glyph: Inter doesn't carry U+2669, so it falls back
            to a system font and sets badly. The tempo row above states the
            value anyway. */}
        {`Session ${formatDuration(sessionSeconds)}`}
      </Text>

      <SecondaryButton
        label="End practice"
        onPress={() => navigation.goBack()}
        style={styles.end}
      />
    </ScreenContainer>
  );
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  notation: {
    marginTop: spacing.lg,
  },
  measure: {
    marginTop: spacing.lg,
  },
  controls: {
    marginTop: spacing.md,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  tempo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bpm: {
    minWidth: 36,
    textAlign: 'center',
  },
  loopLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  session: {
    marginTop: spacing.xl,
    textAlign: 'center',
  },
  end: {
    marginTop: spacing.lg,
  },
});
