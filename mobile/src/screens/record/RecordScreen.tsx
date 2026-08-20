import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Mic, Square } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  EmptyState,
  LoadingState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { usePiece } from '../../data/hooks/usePieces';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { preferences, usePreferences } from '../../data/preferences';
import { PressableScale } from '../../components/motion';
import { takeSubmissionSource } from '../../data/sources';
import type { MetronomeMode } from '../../data/types';
import {
  EmptyRecordingError,
  MAX_TAKE_SECONDS,
  MicrophonePermissionError,
  MicrophoneUnavailableError,
  type Recorder,
} from '../../lib/audio/types';
import { startRecording } from '../../lib/audioRecorder';
import {
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  radii,
  spacing,
} from '../../design';
import { TempoStepper } from '../../components/practice/TempoStepper';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { beatsPerBar, useMetronome } from '../../lib/metronome';
import { describeTierLimit } from '../../lib/tierLimit';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { BeatIndicator } from './BeatIndicator';
import { ListenButton } from './ListenButton';

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
 * Capture is real: `lib/audioRecorder` records mono 16-bit PCM into a WAV on
 * both platforms. Where the file goes afterwards is `takeSubmissionSource`'s
 * question, and it follows the same fixture flag as every read in the app —
 * so the microphone, the permission prompt and the timer can all be exercised
 * before there is a backend to send anything to.
 */
export function RecordScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Record'>>();
  const { data: piece, isPending } = usePiece(params.pieceId);
  const { metronomeMode } = usePreferences();

  // Read through the store so the piece's own marking seeds it and yesterday's
  // choice survives. Subscribing keeps this in step if the tempo is changed
  // elsewhere; the store is the source of truth, not this component.
  usePracticeTempos();
  const targetBpm = practiceTempo.for(params.pieceId, piece?.markedBpm ?? null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const startedAt = useRef(0);

  // The live recorder, held outside state: nothing renders from it, and a
  // re-render between starting and stopping must not lose the handle to a
  // microphone that is currently open.
  const recorder = useRef<Recorder | null>(null);
  const starting = useRef(false);

  // The finished take, kept when sending it fails.
  //
  // It used to be a local in `stop()`, so a failed upload — a dropped
  // connection, a 500, anything — dropped the audio on the floor and the only
  // way forward was to play the whole thing again. The quota message said
  // "Your recording is safe" while this was true, which it was not.
  //
  // A ref rather than state: nothing renders from the blob, and re-rendering
  // between a failure and a retry must not lose it. `pendingTake` below is the
  // state the button reads.
  const unsent = useRef<{ audio: Blob; filename: string } | null>(null);
  const [pendingTake, setPendingTake] = useState(false);

  // Leaving mid-take — back gesture, a deep link, anything — has to release
  // the microphone. Nothing else will.
  useEffect(
    () => () => {
      recorder.current?.cancel();
      recorder.current = null;
    },
    [],
  );

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

  async function start() {
    // `startRecording` awaits a permission prompt, which is long enough for a
    // second tap to open a second microphone nobody would ever close.
    if (starting.current || recorder.current) {
      return;
    }
    starting.current = true;
    impact(ImpactFeedbackStyle.Medium);
    setProblem(null);
    setTruncated(false);
    // A new take supersedes the held one. Without this, "Send it again" stayed
    // on screen through the new recording and would have sent the *previous*
    // take — the same silent substitution this whole change exists to stop,
    // pointing the other way.
    unsent.current = null;
    setPendingTake(false);

    try {
      recorder.current = await startRecording();
    } catch (error) {
      setProblem(messageFor(error));
      return;
    } finally {
      starting.current = false;
    }

    // Only now: the timer has to agree with the file, and the file starts when
    // the hardware does, not when the button was pressed.
    setElapsedMs(0);
    setPhase('recording');
  }

  async function stop() {
    const active = recorder.current;
    recorder.current = null;
    if (!active) {
      setPhase('ready');
      return;
    }

    impact(ImpactFeedbackStyle.Medium);
    setPhase('analysing');

    let recording;
    try {
      recording = await active.stop();
    } catch (error) {
      setProblem(messageFor(error));
      setElapsedMs(0);
      setPhase('ready');
      return;
    }

    setTruncated(recording.truncated);
    await send(recording);
  }

  /**
   * Sends a finished take, keeping it if that fails.
   *
   * Separate from `stop` so a retry runs the same path with the same bytes
   * rather than a second code path that could diverge from the first.
   */
  async function send(recording: { audio: Blob; filename: string }) {
    setPhase('analysing');
    setProblem(null);
    try {
      const analysisId = await takeSubmissionSource.submit({
        // A piece is a score; the id is the same row.
        scoreId: params.pieceId,
        targetBpm,
        metronomeMode,
        audio: recording.audio,
        filename: recording.filename,
      });
      unsent.current = null;
      setPendingTake(false);
      navigation.replace('Verdict', { analysisId });
    } catch (error) {
      // The quota is the one failure a retry cannot clear — the count does not
      // move until next month, so offering "Send again" would be offering the
      // same refusal. Everything else is worth one tap.
      const retriable = describeTierLimit(error) === null;
      unsent.current = retriable ? recording : null;
      setPendingTake(retriable);
      // Back to the top of the screen with the tempo still set, so the reply
      // to a failed take is one tap rather than a re-setup.
      setProblem(messageFor(error));
      setElapsedMs(0);
      setPhase('ready');
    }
  }

  function toggleMetronome() {
    impact(ImpactFeedbackStyle.Light);
    preferences.setMetronomeMode(
      metronomeMode === 'off' ? lastOnMode.current : 'off',
    );
  }

  const recording = phase === 'recording';

  // Runs for the length of the take and no longer. The accent follows the
  // score's own time signature, so "one" lands where the musician is counting
  // it rather than every four beats regardless.
  const perBar = beatsPerBar(piece?.score?.time_signature);
  const metronome = useMetronome({
    mode: metronomeMode,
    bpm: targetBpm,
    timeSignature: piece?.score?.time_signature,
    running: recording,
  });

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
            {truncated
              ? `Only the first ${MAX_TAKE_SECONDS / 60} minutes were kept. Matching them against the score.`
              : 'Matching what you played against the score.'}
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer
      scrollable={false}
      contentStyle={styles.screen}
      footer={
        <View style={styles.footer}>
          {problem ? (
            <Text
              variant="metadataSmall"
              color="textSecondary"
              style={styles.problem}
            >
              {problem}
            </Text>
          ) : null}
          {/*
            Offered only while a take is actually being held, so the control
            appears exactly when the sentence above it says the recording is
            still here. A quota refusal keeps no take and shows no button —
            there is nothing a retry would do but fetch the same refusal.
          */}
          {pendingTake ? (
            <SecondaryButton
              label="Send it again"
              onPress={() => {
                const take = unsent.current;
                if (take) {
                  void send(take);
                }
              }}
              style={styles.retry}
            />
          ) : null}
          <RecordButton
            recording={recording}
            onPress={() => void (recording ? stop() : start())}
          />
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
          <TempoStepper
            label="Target tempo"
            bpm={targetBpm}
            onChange={(next) => practiceTempo.set(params.pieceId, next)}
            disabled={recording}
          />

          {/*
            Locked with the tempo once recording starts: the mode is written
            onto the take, so changing it mid-way would mislabel what was
            actually playing. In visual mode the row it occupies becomes the
            metronome itself — the same height, so nothing above shifts when
            the take begins.
          */}
          {recording && metronomeMode === 'visual' ? (
            <BeatIndicator beat={metronome.beat} perBar={perBar} />
          ) : (
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
          )}

          {/*
            A mode that can't produce anything has to say so. Haptics off in
            the profile silences the haptic metronome completely, and a
            metronome you can't perceive is indistinguishable from the bug this
            feature replaced — stored, displayed, connected to nothing.
          */}
          {metronome.silent ? (
            <Text
              variant="metadataSmall"
              color="textTertiary"
              style={styles.note}
            >
              Haptics are turned off in your profile, so nothing is marking the
              beat.
            </Text>
          ) : null}

          <ListenButton
            score={piece.score}
            bpm={targetBpm}
            // Silenced the moment a take starts: anything through the speaker
            // lands in the microphone as phantom onsets (§4).
            disabled={recording}
          />
        </View>

        <Text variant="screenTitle" style={styles.timer}>
          {formatElapsed(elapsedMs)}
        </Text>
      </View>
    </ScreenContainer>
  );
}

/**
 * What went wrong, in a sentence a musician can act on.
 *
 * Never the underlying error: "NotAllowedError" and "Failed to fetch" tell
 * someone holding a violin nothing they can do anything about. Each of these
 * names the next move instead.
 */
function messageFor(error: unknown): string {
  if (error instanceof MicrophonePermissionError) {
    return 'InTempo needs the microphone to hear you play. Allow it for InTempo, then start again.';
  }
  if (error instanceof MicrophoneUnavailableError) {
    return error.message;
  }
  if (error instanceof EmptyRecordingError) {
    return 'That take came back silent. Check the microphone isn\u2019t muted or covered, then try again.';
  }
  // Before the generic message, because this one is neither a connection
  // problem nor something trying again will fix.
  const quota = describeTierLimit(error);
  if (quota) {
    return quota;
  }
  return 'That take couldn\u2019t be sent. It is still here \u2014 check your connection and send it again.';
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
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
      style={styles.control}
      // More give than the default: this is the one control a musician reaches
      // for without looking, and it has to answer the finger.
      activeScale={0.94}
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
    </PressableScale>
  );
}

const RECORD_SIZE = 88;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    // The container's standard bottom padding is for content that ends above a
    // tab bar. Here the footer owns the bottom edge, so that padding only
    // shows up as extra air under the timer — which is exactly the gap that
    // has to match the two above it.
    paddingBottom: 0,
  },
  centred: {
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    // Distributed rather than centred with a fixed gap. Centring a block in
    // leftover space makes the two voids around it whatever happens to be
    // left, which is how one gap ended up three times the other. This way the
    // interval above the tempo, between it and the timer, and below the timer
    // are the same measure, and they all scale together on a shorter phone.
    justifyContent: 'space-evenly',
  },
  tempo: {
    alignItems: 'center',
    gap: spacing.md,
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
  footer: {
    alignItems: 'center',
  },
  retry: {
    marginBottom: spacing.md,
  },
  problem: {
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  note: {
    textAlign: 'center',
  },
  control: {
    alignItems: 'center',
    gap: spacing.md,
    // Lifted off the bottom edge. The safe-area inset below this only keeps the
    // control clear of the home indicator, which is a different question from
    // where a thumb actually rests — that is around a sixth of the screen up,
    // not against the edge.
    marginBottom: spacing['4xl'],
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
