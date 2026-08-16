import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Minus, Plus, Square } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  EmptyState,
  IconButton,
  LoadingState,
  PageHeader,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { usePiece } from '../../data/hooks/usePieces';
import { usePreferences } from '../../data/preferences';
import { FIXTURE_TAKE_ID_FOR_FLOW } from '../../data/sources/fixtures';
import { CAN_RECORD } from '../../lib/audioRecorder';
import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  radii,
  spacing,
} from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';

/** The tempo range the backend accepts. */
const MIN_BPM = 20;
const MAX_BPM = 300;
const BPM_STEP = 2;

/** Where the tempo starts when the piece has no marking to go on. */
const DEFAULT_BPM = 96;

/** How long the mocked analysis appears to take. */
const MOCK_ANALYSIS_MS = 2200;

const METRONOME_LABELS = {
  off: 'Metronome off',
  visual: 'Visual metronome',
  haptic: 'Haptic metronome',
  audio_with_headphones: 'Audio metronome — headphones',
} as const;

type Phase = 'ready' | 'recording' | 'analysing';

/**
 * Recording a take.
 *
 * The two places the spec allows a number on screen are both here: the target
 * tempo, which the musician set and needs to see, and the elapsed timer, which
 * they are watching. Everywhere else words do the work.
 *
 * The state machine, the timer and the tempo are real. Capturing audio is not
 * — see `lib/audioRecorder` for what it needs and why it isn't faked. Stopping
 * therefore lands on a fixture take rather than analysing silence.
 */
export function RecordScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Record'>>();
  const { data: piece, isPending } = usePiece(params.pieceId);
  const { metronomeMode } = usePreferences();

  const [targetBpm, setTargetBpm] = useState(DEFAULT_BPM);
  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef(0);

  // Wall-clock, not a tick count: a dropped frame would otherwise make the
  // timer disagree with the recording it's timing.
  useEffect(() => {
    if (phase !== 'recording') {
      return;
    }
    startedAt.current = Date.now() - elapsedMs;
    const timer = setInterval(
      () => setElapsedMs(Date.now() - startedAt.current),
      100,
    );
    return () => clearInterval(timer);
    // elapsedMs is read once to resume from where it paused, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== 'analysing') {
      return;
    }
    const timer = setTimeout(() => {
      navigation.replace('Verdict', { analysisId: FIXTURE_TAKE_ID_FOR_FLOW });
    }, MOCK_ANALYSIS_MS);
    return () => clearTimeout(timer);
  }, [navigation, phase]);

  function adjustTempo(by: number) {
    setTargetBpm((bpm) => Math.min(MAX_BPM, Math.max(MIN_BPM, bpm + by)));
  }

  function start() {
    impact(ImpactFeedbackStyle.Medium);
    setElapsedMs(0);
    setPhase('recording');
  }

  function stop() {
    impact(ImpactFeedbackStyle.Medium);
    setPhase('analysing');
  }

  if (isPending) {
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
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  if (phase === 'analysing') {
    return (
      <ScreenContainer scrollable={false} contentStyle={styles.centred}>
        <View>
          <Text variant="heroTitle">Listening back</Text>
          <Text variant="body" color="textSecondary" style={styles.subtitle}>
            Matching what you played against the score.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const recording = phase === 'recording';

  return (
    <ScreenContainer
      scrollable={false}
      contentStyle={styles.screen}
      footer={
        <View style={styles.footer}>
          <RecordButton recording={recording} onPress={recording ? stop : start} />
          <Text variant="metadataSmall" color="textTertiary" style={styles.hint}>
            {recording
              ? 'Play from the top. Stop when you reach the end.'
              : CAN_RECORD
                ? 'Tap to start. The metronome follows your setting.'
                : 'Recording needs an audio module that isn’t installed yet — stopping shows a sample take.'}
          </Text>
        </View>
      }
    >
      <PageHeader
        eyebrow={piece.composer}
        title={piece.title}
        onBack={() => navigation.goBack()}
        backLabel="Back to the piece"
      />

      <View style={styles.body}>
        {/*
          The tempo is locked once recording starts: the analysis compares the
          take against this number, so changing it mid-take would invalidate
          everything already played.
        */}
        <View style={styles.tempo}>
          <Text variant="sectionLabel" color="textSecondary">
            Target tempo
          </Text>

          <View style={styles.tempoRow}>
            <IconButton
              icon={Minus}
              label="Slower"
              onPress={() => adjustTempo(-BPM_STEP)}
              disabled={recording || targetBpm <= MIN_BPM}
            />
            <View style={styles.reading}>
              <Text variant="screenTitle" style={styles.bpm}>
                {targetBpm}
              </Text>
              <Text variant="metadata" color="textTertiary">
                BPM
              </Text>
            </View>
            <IconButton
              icon={Plus}
              label="Faster"
              onPress={() => adjustTempo(BPM_STEP)}
              disabled={recording || targetBpm >= MAX_BPM}
            />
          </View>

          <Text variant="metadataSmall" color="textTertiary">
            {METRONOME_LABELS[metronomeMode]}
          </Text>
        </View>

        <Text variant="screenTitle" style={styles.timer}>
          {formatElapsed(elapsedMs)}
        </Text>
      </View>
    </ScreenContainer>
  );
}

/** `03:07`. Minutes and seconds only — a take is not an hour long. */
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The one control on the screen, sized to be found without looking — a
 * musician reaching for it has an instrument in their hands.
 */
function RecordButton({
  recording,
  onPress,
}: {
  recording: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
      style={({ pressed }) => [styles.record, pressed && styles.recordPressed]}
    >
      {recording ? (
        <Square
          size={ICON_SIZE.lg}
          strokeWidth={ICON_STROKE_WIDTH}
          color={colors.actionText}
          fill={colors.actionText}
        />
      ) : (
        <View style={styles.dot} />
      )}
    </Pressable>
  );
}

const RECORD_SIZE = 88;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centred: {
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing['4xl'],
  },
  tempo: {
    alignItems: 'center',
    gap: spacing.md,
  },
  tempoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2xl'],
  },
  reading: {
    alignItems: 'center',
    minWidth: 96,
  },
  bpm: {
    // Digits change every step; without this the row twitches as widths shift.
    fontVariant: ['tabular-nums'],
  },
  timer: {
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  subtitle: {
    marginTop: spacing.md,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  hint: {
    textAlign: 'center',
  },
  record: {
    width: RECORD_SIZE,
    height: RECORD_SIZE,
    borderRadius: RECORD_SIZE / 2,
    backgroundColor: colors.actionBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordPressed: {
    backgroundColor: colors.actionBgPressed,
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.actionText,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.actionText,
  },
});
