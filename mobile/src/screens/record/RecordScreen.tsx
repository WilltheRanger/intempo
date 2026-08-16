import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Mic, Minus, Plus, Square } from 'lucide-react-native';
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
import { preferences, usePreferences } from '../../data/preferences';
import type { MetronomeMode } from '../../data/types';
import { FIXTURE_TAKE_ID_FOR_FLOW } from '../../data/sources/fixtures';
import {
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

/**
 * What the toggle turns on when there's no earlier choice to restore.
 *
 * Visual rather than audio: a click through the phone's speaker is the one
 * mode that would end up inside the recording it's supposed to be timing.
 */
const DEFAULT_ON_MODE: MetronomeMode = 'visual';

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
 * therefore lands on a fixture take rather than analysing silence. That gap
 * stays out of the interface: what's missing here is a dependency, which is a
 * note for whoever installs it and not something to tell a musician about.
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

  // Turning the metronome back on restores the mode it was on, rather than
  // silently demoting someone's haptic or headphone choice to the default.
  const lastOnMode = useRef<MetronomeMode>(
    metronomeMode === 'off' ? DEFAULT_ON_MODE : metronomeMode,
  );
  if (metronomeMode !== 'off') {
    lastOnMode.current = metronomeMode;
  }

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

  function toggleMetronome() {
    impact(ImpactFeedbackStyle.Light);
    preferences.setMetronomeMode(
      metronomeMode === 'off' ? lastOnMode.current : 'off',
    );
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
        <RecordButton recording={recording} onPress={recording ? stop : start} />
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

          {/*
            Locked with the tempo once recording starts: the mode is written
            onto the take, so changing it mid-way would mislabel what was
            actually playing.
          */}
          <Pressable
            onPress={toggleMetronome}
            disabled={recording}
            accessibilityRole="switch"
            // The ARIA props rather than `accessibilityState`: react-native-web
            // maps these through to the DOM, and drops `accessibilityState`'s
            // `checked` entirely, so the web build would announce a switch with
            // no on or off. On native both spellings land in the same place.
            aria-checked={metronomeMode !== 'off'}
            aria-disabled={recording}
            accessibilityLabel="Metronome"
            style={({ pressed }) => [
              styles.metronome,
              pressed && styles.metronomePressed,
            ]}
          >
            <Text
              variant="metadataSmall"
              // Gold in both states, because gold is what a tappable label
              // looks like everywhere else in the app. The word carries on or
              // off; the colour only says this line does something. Locked
              // during a take, it drops back to metadata.
              color={recording ? 'textTertiary' : 'accent'}
            >
              {METRONOME_LABELS[metronomeMode]}
            </Text>
          </Pressable>
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
 *
 * Named as well as drawn. A bare circle has to be guessed at, and the guess
 * that costs a take is guessing that the idle control is a stop button. So
 * idle is a microphone over the word Start, and recording is a filled square
 * over the word Stop — a shape people already read as stop, and a word to
 * settle it either way. The label is part of the tap target, not a caption.
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
      style={styles.control}
    >
      {({ pressed }) => (
        <>
          <View style={[styles.record, pressed && styles.recordPressed]}>
            {recording ? (
              <Square
                size={ICON_SIZE.lg}
                strokeWidth={ICON_STROKE_WIDTH}
                color={colors.actionText}
                fill={colors.actionText}
              />
            ) : (
              <Mic
                size={ICON_SIZE.lg}
                strokeWidth={ICON_STROKE_WIDTH}
                color={colors.actionText}
              />
            )}
          </View>
          <Text variant="metadata">
            {recording ? 'Stop recording' : 'Start recording'}
          </Text>
        </>
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
  metronome: {
    // A 44pt row rather than a line of text, negative-margined back so the
    // stack above doesn't move to accommodate the touch target.
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    marginVertical: -spacing.md,
    borderRadius: radii.sm,
  },
  metronomePressed: {
    backgroundColor: colors.surfacePressed,
  },
  control: {
    alignItems: 'center',
    gap: spacing.md,
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
});
