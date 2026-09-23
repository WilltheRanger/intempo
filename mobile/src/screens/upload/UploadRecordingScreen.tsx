import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ChevronRight, FileMusic, Pause, Play } from '../../components/icons';
import { BottomSheet } from '../../components/overlays/BottomSheet';
import {
  BackLink,
  EmptyState,
  LoadingState,
  PrimaryButton,
  ScreenContainer,
  SCREEN_GUTTER,
  Text,
} from '../../components/primitives';
import { StartBarPicker } from '../../components/score/StartBarPicker';
import { useMe } from '../../data/hooks/useMe';
import { usePieceHistory } from '../../data/hooks/useLatestTake';
import { usePiece } from '../../data/hooks/usePieces';
import {
  clearPickedFile,
  queuePickedFileForSend,
  stagePickedFile,
  stagedPickedFile,
  type PickedFile,
} from '../../data/practice/pickedTake';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import {
  BORDER_WIDTH,
  colors,
  fontFamily,
  ICON_STROKE_WIDTH,
  radii,
  spacing,
} from '../../design';
import {
  describeAnalysisCost,
  describeReachedAnalysisLimit,
} from '../../lib/analysisAllowance';
import { readFilePreview, type FilePreview } from '../../lib/audio/filePreview';
import { sizeLabel } from '../../lib/audio/waveform';
import { loadStateFor } from '../../lib/loadState';
import { extensionOf } from '../../lib/record/pickedTake';
import { startOptions } from '../../lib/record/startOptions';
import { scheduleScore, startableMeasures } from '../../lib/score';
import { clockLabel } from '../../lib/score/listenPosition';
import { displayTempoBpm, tempoUnitLabel } from '../../lib/tempo';
import { bpmForMarking } from '../../lib/tempoMarking';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { useGoBack } from '../../navigation/useGoBack';
import { chooseAudioFile } from '../record/chooseAudioFile';
import { StartFromSheet } from '../record/StartFromSheet';
import { usePreviewPlayback } from './usePreviewPlayback';

/** The waveform's bars: 2pt wide on a 5.1pt step, as the prototype draws. */
const BAR_WIDTH = 2;
const BAR_STEP = 5.1;
const WAVE_HEIGHT = 46;

/**
 * Upload a recording (`redesign/UploadRecording.dc.html`, 2026-09-23).
 *
 * The take a musician cares most about is often already on their phone — a
 * lesson, a run-through caught on a voice memo — and it cannot be played again
 * for the app's benefit. This screen is where they look at the file before
 * spending an analysis on it: its name, length and shape, a play control to
 * be sure it is the right one, and the two settings that decide what it is
 * judged against — where it starts, and the target tempo.
 *
 * **It only chooses; Record sends.** "Send for analysis" hands the file back
 * (`data/practice/pickedTake`), and Record sends it through the same path as a
 * recorded take — the wait, the failures, "Send it again".
 */
export function UploadRecordingScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'UploadRecording'>>();
  const backToRecord = useGoBack({ route: 'Record', params: { pieceId: params.pieceId } });
  const { data: piece, isError } = usePiece(params.pieceId);
  const { data: musician } = useMe();
  const { data: history } = usePieceHistory(params.pieceId);
  usePracticeTempos();

  const [file, setFile] = useState<PickedFile | null>(() => stagedPickedFile(params.pieceId));
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview>({ durationS: null, peaks: null });
  const [waveWidth, setWaveWidth] = useState(0);
  const [pickingStart, setPickingStart] = useState(false);
  const [pickingBar, setPickingBar] = useState(false);
  const [chosenStart, setChosenStart] = useState<number | null>(null);
  const playback = usePreviewPlayback(file?.audio ?? null);

  const bars = Math.max(0, Math.floor((waveWidth + BAR_STEP - BAR_WIDTH) / BAR_STEP));
  useEffect(() => {
    let cancelled = false;
    setPreview({ durationS: null, peaks: null });
    if (file && bars > 0) {
      void readFilePreview(file.audio, bars).then((read) => {
        if (!cancelled) setPreview(read);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [file, bars]);

  const marking = piece?.score?.tempo_marking ?? null;
  const markedQuarter = piece?.markedBpm ?? (piece ? bpmForMarking(marking) : null);
  const targetBpm = practiceTempo.for(params.pieceId, markedQuarter ?? null);
  const startable = useMemo(
    () => (piece?.score ? startableMeasures(scheduleScore(piece.score, targetBpm)) : []),
    [piece?.score, targetBpm],
  );
  const startFrom =
    chosenStart !== null && startable.includes(chosenStart) ? chosenStart : (startable[0] ?? 1);
  const choices = useMemo(
    () => startOptions(startable, history?.recent[0] ?? null),
    [startable, history],
  );

  if (loadStateFor({ isError, hasData: piece !== undefined }) === 'loading') {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }
  if (!piece) {
    return (
      <ScreenContainer>
        <EmptyState
          title="Couldn't open this piece"
          description="It may have been removed from your library."
          actionLabel="Back"
          onActionPress={backToRecord}
        />
      </ScreenContainer>
    );
  }

  const unit = piece.score?.tempo_beat_unit ?? null;
  const limit = describeReachedAnalysisLimit(musician?.usage);
  const cost = describeAnalysisCost(musician?.usage);

  async function choose() {
    const chosen = await chooseAudioFile();
    if (chosen.kind === 'picked') {
      stagePickedFile(params.pieceId, chosen.file);
      setFile(chosen.file);
      setProblem(null);
    } else if (chosen.kind === 'failed') {
      setProblem(chosen.message);
    }
  }

  function leave() {
    clearPickedFile(params.pieceId);
    backToRecord();
  }

  function send() {
    if (queuePickedFileForSend(params.pieceId, startFrom)) {
      backToRecord();
    }
  }

  function handleWaveLayout(event: LayoutChangeEvent) {
    const measured = event.nativeEvent.layout.width;
    setWaveWidth((current) => (current === measured ? current : measured));
  }

  const durationS = playback.duration ?? preview.durationS;
  const played = durationS && durationS > 0 ? playback.position / durationS : 0;
  const meta = file
    ? [
        durationS !== null ? clockLabel(durationS) : null,
        sizeLabel(file.sizeBytes),
        extensionOf(file.name).toUpperCase() || null,
      ]
        .filter(Boolean)
        .join('  ·  ')
    : null;

  return (
    <ScreenContainer
      footer={
        <View>
          <PrimaryButton
            label="Send for analysis"
            onPress={send}
            disabled={!file || limit !== null}
          />
          {limit ?? cost ? (
            <Text variant="metadataSmall" color="textTertiary" style={styles.cost}>
              {limit ?? cost}
            </Text>
          ) : null}
        </View>
      }
    >
      <View style={styles.head}>
        <BackLink label="Back to recording" onPress={leave} />
        <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow} numberOfLines={1}>
          {piece.title}
        </Text>
        <Text variant="heroTitle" accessibilityRole="header">
          Upload a recording
        </Text>
      </View>

      {/* The file, on a white band the width of the screen. */}
      <View style={styles.band}>
        <View style={styles.fileRow}>
          <View style={styles.fileIcon}>
            <FileMusic size={20} strokeWidth={1.5} color={colors.textSecondary} />
          </View>
          <View style={styles.fileText}>
            <Text variant="body" numberOfLines={1} style={styles.fileName}>
              {file ? file.name : 'No recording chosen'}
            </Text>
            <Text variant="caption" color="textTertiary" style={styles.fileMeta}>
              {meta || 'WAV, MP3, M4A, FLAC and OGG all work'}
            </Text>
          </View>
        </View>

        <View
          style={styles.wave}
          onLayout={handleWaveLayout}
          accessible={preview.peaks !== null}
          accessibilityLabel={preview.peaks ? 'Waveform of the recording' : undefined}
        >
          {(preview.peaks ?? []).map((peak, index, all) => (
            <View
              key={index}
              style={[
                styles.waveBar,
                {
                  height: Math.max(3, peak * WAVE_HEIGHT),
                  backgroundColor:
                    index / all.length < played ? colors.accent : colors.borderStrong,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.fileActions}>
          <Pressable
            onPress={() => void choose()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text variant="metadataSmall" color="accentText" style={styles.medium}>
              {file ? 'Choose a different file' : 'Choose a file'}
            </Text>
          </Pressable>
          {file && playback.available ? (
            <Pressable
              onPress={() => void playback.toggle()}
              accessibilityRole="button"
              accessibilityLabel={playback.playing ? 'Pause the recording' : 'Play the recording'}
              style={({ pressed }) => [styles.action, styles.play, pressed && styles.pressed]}
            >
              {playback.playing ? (
                <Pause size={14} strokeWidth={ICON_STROKE_WIDTH} color={colors.textPrimary} fill={colors.textPrimary} />
              ) : (
                <Play size={14} strokeWidth={ICON_STROKE_WIDTH} color={colors.textPrimary} fill={colors.textPrimary} />
              )}
              <Text variant="metadataSmall">{playback.playing ? 'Pause' : 'Play'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {problem ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.problem} accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}

      <View style={styles.rows}>
        <View style={styles.row}>
          <Text variant="sectionLabel" style={styles.rowLabel}>
            Piece
          </Text>
          <Text variant="body" color="textSecondary" numberOfLines={1} style={styles.rowValue}>
            {piece.title}
          </Text>
        </View>
        <Pressable
          onPress={() => setPickingStart(true)}
          accessibilityRole="button"
          accessibilityLabel={`Start at bar ${startFrom}. Change where the recording begins.`}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <Text variant="sectionLabel" style={styles.rowLabel}>
            Start at
          </Text>
          <Text variant="body" color="textSecondary" style={styles.rowValue}>
            Bar {startFrom}
          </Text>
          <ChevronRight size={18} strokeWidth={1.6} color={colors.textTertiary} />
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('Tempo', { pieceId: params.pieceId })}
          accessibilityRole="button"
          accessibilityLabel={`Target tempo ${displayTempoBpm(targetBpm, unit)} ${tempoUnitLabel(unit)}. Change it`}
          style={({ pressed }) => [styles.row, styles.lastRow, pressed && styles.rowPressed]}
        >
          <Text variant="sectionLabel" style={styles.rowLabel}>
            Target tempo
          </Text>
          <Text variant="body" color="textSecondary" style={styles.rowValue}>
            {displayTempoBpm(targetBpm, unit)} {tempoUnitLabel(unit)}
          </Text>
          <ChevronRight size={18} strokeWidth={1.6} color={colors.textTertiary} />
        </Pressable>
      </View>

      <StartFromSheet
        visible={pickingStart}
        options={choices}
        startFrom={startFrom}
        onPick={(bar) => {
          setChosenStart(bar);
          setPickingStart(false);
        }}
        onClose={() => setPickingStart(false)}
        onChoose={() => {
          setPickingStart(false);
          setPickingBar(true);
        }}
        chooseHint="Pick any bar"
      />
      {piece.score ? (
        <BottomSheet
          visible={pickingBar}
          onClose={() => setPickingBar(false)}
          title="Start at"
          expand
        >
          <StartBarPicker
            score={piece.score}
            bars={startable}
            value={startFrom}
            onChange={(bar) => {
              setChosenStart(bar);
              setPickingBar(false);
            }}
          />
        </BottomSheet>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingTop: spacing.xs,
    paddingBottom: 34,
  },
  eyebrow: {
    marginTop: 2,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  // Full width: the band cancels the screen's gutter and puts it back inside.
  band: {
    marginHorizontal: -SCREEN_GUTTER,
    paddingHorizontal: SCREEN_GUTTER,
    paddingVertical: 18,
    backgroundColor: colors.surface,
    borderTopWidth: BORDER_WIDTH,
    borderBottomWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  fileIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileText: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontFamily: fontFamily.sansMedium,
    fontSize: 15,
    lineHeight: 20,
  },
  fileMeta: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: BAR_STEP - BAR_WIDTH,
    height: WAVE_HEIGHT,
    marginTop: spacing.lg,
  },
  waveBar: {
    width: BAR_WIDTH,
    borderRadius: 1,
  },
  fileActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  action: {
    minHeight: 44,
    justifyContent: 'center',
  },
  play: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  pressed: {
    opacity: 0.55,
  },
  medium: {
    fontFamily: fontFamily.sansMedium,
  },
  problem: {
    marginTop: spacing.md,
  },
  rows: {
    marginTop: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: 14,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  lastRow: {
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfacePressed,
  },
  rowLabel: {
    flex: 1,
    color: colors.textPrimary,
  },
  rowValue: {
    fontSize: 15,
    lineHeight: 20,
    flexShrink: 1,
  },
  cost: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
