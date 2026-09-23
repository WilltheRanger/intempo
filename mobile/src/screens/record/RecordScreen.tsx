import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { Mic, MoreVertical, Square } from '../../components/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {
  BackLink,
  Card,
  EmptyState,
  LinkRow,
  LoadingState,
  ScreenContainer,
  SecondaryButton,
  Text,
  ToggleRow,
} from '../../components/primitives';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePiece } from '../../data/hooks/usePieces';
import { usePieceHistory } from '../../data/hooks/useLatestTake';
import { meKeys, useMe } from '../../data/hooks/useMe';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { bpmForMarking } from '../../lib/tempoMarking';
import { preferences, usePreferences } from '../../data/preferences';
import { PressableScale } from '../../components/motion';
import { takeSubmissionSource } from '../../data/sources';
import {
  TakeSubmissionError,
  type TakeSubmissionState,
} from '../../data/practice/submitTake';
import { forgetPendingAnalysis } from '../../data/practice/pendingAnalysis';
import type { MetronomeMode } from '../../data/types';
import {
  EmptyRecordingError,
  MicrophonePermissionError,
  type Recorder,
} from '../../lib/audio/types';
import { ACCEPTED_LABEL } from '../../lib/record/pickedTake';
import {
  stagePickedFile,
  takeQueuedPickedFile,
} from '../../data/practice/pickedTake';
import { chooseAudioFile } from './chooseAudioFile';
import { playheadAt } from '../../lib/record/playhead';
import type { CaptureReport } from '../../lib/audio/capture';
import { readTakeFailure } from '../../lib/audio/takeFailure';
import { heldTakeUrl, releaseHeldTake } from '../../lib/audio/heldTake';
import { HeldTakePlayer } from './HeldTakePlayer';
import { microphonePermissionRecovery } from '../../lib/audio/permission';
import { buildMarker } from '../../lib/platform/buildMarker';
import { isHomeScreenApp } from '../../lib/audio/microphoneFailure';
import { canReloadPage, reloadPage } from '../../lib/platform/reloadPage';
import {
  keepTakeForLater,
  restoreQueuedTake,
  takeWasAccepted,
} from '../../lib/sync/queuedTakes';
import { startRecording } from '../../lib/audioRecorder';
import {
  BORDER_WIDTH,
  colors,
  disabledOpacity,
  fontFamily,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  spacing,
} from '../../design';
import {
  elapsedLabel,
  isTakingLong,
  progressFor,
} from '../../lib/analysis/waitProgress';
import { BottomSheet } from '../../components/overlays/BottomSheet';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { displayTempoBpm, tempoUnitLabel } from '../../lib/tempo';
import { metronomePulse, monotonicNow, useMetronome } from '../../lib/metronome';
import { countInIsOver } from '../../lib/metronome/countIn';
import { buildMetronomePlan } from '../../lib/metronome/plan';
import {
  longRestCues,
  restCueAt,
  restPulseDots,
  type RestCueState,
} from '../../lib/practiceCues';
import { shortenLongRests, skippableBars } from '../../lib/notation/longRests';
import { openingTimeSignature } from '../../lib/notation/meter';
import {
  describeLastFreeAnalysis,
  describeReachedAnalysisLimit,
} from '../../lib/analysisAllowance';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { BeatIndicator } from './BeatIndicator';
import { PracticeSetup } from './PracticeSetup';
import { takeStatus } from '../../lib/record/takeStatus';
import {
  metronomeChoices,
  metronomeValueLabel,
} from '../../lib/record/metronomeChoice';
import { ScoreScroll } from '../../components/score/ScoreScroll';
import { startOptions } from '../../lib/record/startOptions';
import { entryAccessibilityLabel, entryRowLabel } from '../../lib/score/entryCopy';
import { ListenPlayer } from './ListenPlayer';
import { PillRow } from './PillRow';
import { StartFromSheet } from './StartFromSheet';
import { scheduleScore, startableMeasures } from '../../lib/score';
import { startFromMeasure } from '../../lib/score/startFrom';
import { hasWarning, preflight } from '../../lib/record/preflight';
import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import {
  leavingRecord,
  shouldGuardBrowserExit,
  type RecordPhase,
} from '../../lib/record/leaving';
import { useGoBack } from '../../navigation/useGoBack';
import { loadStateFor } from '../../lib/loadState';

/**
 * What the toggle turns on when there's no earlier choice to restore.
 *
 * Visual rather than audio: a click through the phone's speaker is the one
 * mode that would end up inside the recording it's supposed to be timing.
 */
const DEFAULT_ON_MODE: MetronomeMode = 'visual';

/**
 * One union, not two. `leavingRecord` decides what each phase is worth asking
 * about, and a copy here would let a new phase be added to the screen and not
 * to the rule — where an unknown phase falls through to "just leave", which is
 * the answer that loses a take.
 */
type Phase = RecordPhase;

/**
 * Recording a take.
 *
 * Numbers appear only where a musician has to act on them: target tempo,
 * elapsed time, the count-in, and the final beats before a re-entry.
 *
 * Capture is real: `lib/audioRecorder` records mono 16-bit PCM into a WAV on
 * both platforms. Where the file goes afterwards is `takeSubmissionSource`'s
 * question, and it follows the same fixture flag as every read in the app —
 * so the microphone, the permission prompt and the timer can all be exercised
 * before there is a backend to send anything to.
 */
export function RecordScreen() {
  const navigation = useNavigation<RootNavigation>();
  const queryClient = useQueryClient();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Record'>>();
  const goBack = useGoBack({ route: 'PieceDetail', params: { pieceId: params.pieceId } });
  const { data: piece, isError } = usePiece(params.pieceId);
  // This is the same cached account read held by the signed-in gate, not a
  // second request. It lets the screen refuse an impossible take before the
  // musician plays it rather than after the WAV has already been uploaded.
  const { data: musician } = useMe();
  const limitMessage = describeReachedAnalysisLimit(musician?.usage);
  const { instrument, metronomeMode, practiceSetupSeen, lastTakeHadSound } =
    usePreferences();

  // Read through the store so the piece's own marking seeds it and yesterday's
  // choice survives. Subscribing keeps this in step if the tempo is changed
  // elsewhere; the store is the source of truth, not this component.
  usePracticeTempos();
  /**
   * What the page says the tempo is, and how it says it.
   *
   * A metronome mark first, because it is a *reading*. Failing that, the
   * conventional speed of a printed word — a page headed "Allegro moderato"
   * and nothing else left `markedBpm` null, and the practice tempo fell back
   * to 80: a moderately fast movement offered at a walking pace, on most of
   * the standard repertoire, since editors wrote words rather than marks until
   * well into the nineteenth century.
   *
   * The word is a convention and not a reading, so the screen says so under
   * the control rather than presenting the number as the page's own.
   */
  const marking = piece?.score?.tempo_marking ?? null;
  const markingBpm = piece?.markedBpm === null || piece?.markedBpm === undefined
    ? bpmForMarking(marking)
    : null;
  const targetBpm = practiceTempo.for(
    params.pieceId,
    piece?.markedBpm ?? markingBpm,
  );
  const tempoBeatUnit = piece?.score?.tempo_beat_unit ?? null;
  const displayedBpm = displayTempoBpm(targetBpm, tempoBeatUnit);
  const [phase, setPhase] = useState<Phase>('ready');
  // The first recording on this device gets a short orientation before the
  // system permission prompt. It can always be reopened from the ready screen.
  /**
   * The pre-flight screen, which now opens only when it has something to say.
   *
   * **It used to be `!practiceSetupSeen`** — shown once to everybody, whatever
   * the checks came back with. On a take with nothing wrong that is two rows
   * of ✓ and a paragraph between a musician holding an instrument and the
   * record button, and both of its items are already on the screen behind it:
   * the entry bar is the "Start at" row and the metronome is the row above it.
   *
   * Starting `false` and raised by an effect, because the decision needs
   * `checks`, and `checks` needs `startFrom` and the score — none of which
   * exist at the first `useState`. `hasWarning` is the rule and it is tested.
   */
  const [showSetup, setShowSetup] = useState(false);
  /** The two doors that did not fit in the settings column. See the row. */
  const [showMore, setShowMore] = useState(false);
  /** The open metronome picker — how all four modes became reachable here. */
  const [pickingMetronome, setPickingMetronome] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  /**
   * Which leg the analysis has reached, and how long the wait has run.
   *
   * Separate from `elapsedMs`, which is the *take's* clock and is reset by
   * every path that starts one. These belong to the wait that follows and
   * would be wrong the moment the take timer were reset under them.
   */
  const [analysisStage, setAnalysisStage] = useState<string | null>(null);
  const [waitingMs, setWaitingMs] = useState(0);
  const [hasInputSignal, setHasInputSignal] = useState(false);
  // The wait's own clock, on `monotonicNow` for the reason the take's timer
  // uses it: a phone that sleeps mid-analysis must not show a jump or a
  // negative, and wall-clock time does both.
  useEffect(() => {
    if (phase !== 'analysing') return;
    const since = monotonicNow();
    setWaitingMs(0);
    const timer = setInterval(() => setWaitingMs(monotonicNow() - since), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'counting_in') return;
    const timer = setInterval(() => {
      setHasInputSignal((recorder.current?.inputPeak?.() ?? 0) > 0);
    }, 200);
    return () => clearInterval(timer);
  }, [phase]);
  const [problem, setProblem] = useState<string | null>(null);
  // A constant for the life of the document — the bundle cannot change under a
  // running page — so it is read once rather than on every render.
  const marker = useMemo(() => buildMarker(isHomeScreenApp()), []);
  const lastFreeMessage = describeLastFreeAnalysis(musician?.usage);
  const visibleProblem = limitMessage ?? problem;
  const [microphoneBlocked, setMicrophoneBlocked] = useState(false);
  // The platform's own directions, read once — see `permission.ts`. Cheap and
  // pure, and `Platform.OS` cannot change under a running app.
  const microphoneRecovery = useMemo(
    () => microphonePermissionRecovery(Platform.OS),
    [],
  );
  /**
   * Whether the failure on screen is one the page can fix by reloading itself.
   *
   * Held beside `problem` rather than derived from it, because by the time a
   * message reaches this component it is prose — the `DOMException` that knew
   * the answer is three layers back. `readTakeFailure` carries it out.
   */
  const [canReload, setCanReload] = useState(false);
  const [truncated, setTruncated] = useState(false);
  // How much was actually kept. The cap is bytes, not minutes — a device at
  // 44.1 kHz fits nearly a minute more music into the same file than one at 48
  // — so the number in the sentence below has to come from the take rather
  // than from a constant. It used to be `MAX_TAKE_SECONDS / 60`, which stopped
  // being the truth the moment the upload limit turned out to bind first.
  const [keptSeconds, setKeptSeconds] = useState(0);
  const startedAt = useRef(0);

  // The live recorder, held outside state: nothing renders from it, and a
  // re-render between starting and stopping must not lose the handle to a
  // microphone that is currently open.
  const recorder = useRef<Recorder | null>(null);
  const mounted = useRef(true);
  const starting = useRef(false);
  const [isStarting, setIsStarting] = useState(false);

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
  const unsent = useRef<{
    audio: Blob;
    filename: string;
    contentType?: string;
    resume?: TakeSubmissionState;
    capture?: CaptureReport;
    fromMeasure?: number;
  } | null>(null);
  const [pendingTake, setPendingTake] = useState(false);
  /**
   * A URL for the take being held, so it can be heard before it is sent.
   *
   * **The screen says the take is safe and had no way to show it.** "Your take
   * is safe on this device" is the sentence a musician most needs to believe
   * after a failed upload, and it was an assertion. Null where no URL can be
   * made — see `heldTakeUrl` — in which case no control is drawn at all rather
   * than one that does nothing.
   */
  const [heldUrl, setHeldUrl] = useState<string | null>(null);
  /** The open "you are about to lose this" dialog, or null. */
  const [leavePrompt, setLeavePrompt] = useState<
    Extract<ReturnType<typeof leavingRecord>, { kind: 'confirm' }> | null
  >(null);

  /**
   * Point the "hear it" control at a held take, or at nothing.
   *
   * **Revoking matters.** An object URL pins the whole blob for the life of the
   * document and a take is minutes of audio, so every path that stops holding a
   * take passes null through here — sent, discarded, or replaced by a new
   * recording.
   */
  function holdForListening(audio: Blob | null): void {
    setHeldUrl((current) => {
      releaseHeldTake(current);
      return audio ? heldTakeUrl(audio) : null;
    });
  }

  // Leaving mid-take — back gesture, a deep link, anything — has to release
  // the microphone. Nothing else will.
  useEffect(
    () => {
      mounted.current = true;
      return () => {
        mounted.current = false;
        recorder.current?.cancel();
        recorder.current = null;
      };
    },
    [],
  );

  /**
   * **The phase the guard reads, written at the same instant as the state.**
   *
   * `beforeRemove` fires inside the `navigation.replace` call, before React has
   * committed anything set beside it — so a listener closed over `phase` and
   * `pendingTake` is one render stale exactly when it is consulted. The case
   * that broke: a retried take succeeds, `send` clears the held take and
   * replaces the screen with the verdict, and the guard — still seeing the take
   * as unsent — blocked the navigation and asked whether to discard a take that
   * had just been accepted. Refs are the fix, not a dependency array.
   */
  const phaseRef = useRef<Phase>('ready');
  function goPhase(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  /** Set once the musician has said yes, so the guard lets the second go through. */
  const leaving = useRef(false);
  /** The navigation `beforeRemove` held back, replayed if they confirm. */
  const blocked = useRef<(() => void) | null>(null);

  /**
   * **The cleanup above is correct and silent, which is the whole problem.**
   * Releasing the microphone also throws away what it captured, so leaving
   * mid-take lost the recording on one reflex tap with nothing said about it.
   *
   * `beforeRemove` rather than an `onPress` on the chevron, because the chevron
   * is the one way out that is *not* the risk: the swipe-back gesture, Android's
   * system back and the browser's back button all remove this screen without
   * touching a control the app drew. A guard on the button would have covered
   * the deliberate exit and missed every accidental one.
   *
   * What is worth asking about lives in `lib/record/leaving.ts`, where it can
   * be tested — there is no React Native testing library here.
   */
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (leaving.current) {
          return;
        }
        const answer = leavingRecord({
          phase: phaseRef.current,
          // The ref, not `pendingTake`: `send` clears it synchronously on the
          // line above the navigation that fires this listener.
          unsentTake: unsent.current !== null,
          pieceTitle: piece?.title,
        });
        if (answer.kind !== 'confirm') {
          return;
        }
        event.preventDefault();
        blocked.current = () => navigation.dispatch(event.data.action);
        setLeavePrompt(answer);
      }),
    [navigation, piece?.title],
  );

  // A refresh, closed tab, or changed address bypasses React Navigation and
  // used to throw away a live take or the finished WAV currently uploading.
  // Browsers deliberately control the wording of this confirmation; our job
  // is only to request it while audio really would be lost.
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    function guardBrowserExit(event: BeforeUnloadEvent) {
      if (
        !shouldGuardBrowserExit({
          phase: phaseRef.current,
          unsentTake: unsent.current !== null,
        })
      ) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', guardBrowserExit);
    return () => window.removeEventListener('beforeunload', guardBrowserExit);
  }, []);

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
    startedAt.current = monotonicNow() - elapsedMs;
    const timer = setInterval(
      () => setElapsedMs(monotonicNow() - startedAt.current),
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
    if (limitMessage) {
      // The disabled control prevents ordinary taps; this guard protects a
      // stale queued press and future callers from opening the microphone.
      setProblem(limitMessage);
      return;
    }
    starting.current = true;
    setIsStarting(true);
    impact(ImpactFeedbackStyle.Medium);
    setProblem(null);
    setHasInputSignal(false);
    setMicrophoneBlocked(false);
    setTruncated(false);
    setKeptSeconds(0);
    // A new take supersedes the held one. Without this, "Send it again" stayed
    // on screen through the new recording and would have sent the *previous*
    // take — the same silent substitution this whole change exists to stop,
    // pointing the other way.
    unsent.current = null;
    setPendingTake(false);
    holdForListening(null);

    try {
      const started = await startRecording();
      // Permission may resolve after the musician has already left. Never
      // retain a microphone opened for a screen that no longer exists.
      if (!mounted.current) {
        started.cancel();
        return;
      }
      recorder.current = started;
    } catch (error) {
      if (!mounted.current) return;
      setMicrophoneBlocked(error instanceof MicrophonePermissionError);
      const failure = readTakeFailure(error, Platform.OS);
      setProblem(failure.message);
      setCanReload(failure.recovery === 'reload' && canReloadPage());
      return;
    } finally {
      starting.current = false;
      if (mounted.current) setIsStarting(false);
    }

    // The recorder starts before the count-in. Its leading silence is intentional:
    // alignment already ignores startup silence, while beginning the microphone
    // afterwards would put an unpredictable hardware delay between "one" and
    // the first playable downbeat.
    setElapsedMs(0);
    goPhase('counting_in');
  }

  function cancelCountIn() {
    recorder.current?.cancel();
    recorder.current = null;
    setElapsedMs(0);
    goPhase('ready');
  }

  /** Confirmed: the audio goes, and so does the screen. */
  function confirmLeave() {
    recorder.current?.cancel();
    recorder.current = null;
    unsent.current = null;
    setLeavePrompt(null);
    // Past the guard below, then the navigation that was held back.
    leaving.current = true;
    const held = blocked.current;
    blocked.current = null;
    if (held) {
      held();
    } else {
      goBack();
    }
  }

  async function stop() {
    const active = recorder.current;
    recorder.current = null;
    if (!active) {
      goPhase('ready');
      return;
    }

    impact(ImpactFeedbackStyle.Medium);
    goPhase('analysing');

    let recording;
    try {
      recording = await active.stop();
    } catch (error) {
      const failure = readTakeFailure(error, Platform.OS);
      setProblem(failure.message);
      setCanReload(failure.recovery === 'reload' && canReloadPage());
      setElapsedMs(0);
      /*
        Remember that this one had nothing in it, so the next take can be
        warned before it is played rather than after.

        `lib/audio/level.ts` refuses an all-zero take here — a muted input, a
        revoked permission, a device recording from an unrouted source — and
        that refusal used to be the end of it: the musician saw one message,
        fixed nothing, and recorded the same silence again. The pre-flight is
        where that becomes useful, and it needs this to have been written down.
      */
      if (error instanceof EmptyRecordingError) {
        preferences.setLastTakeHadSound(false);
      }
      goPhase('ready');
      return;
    }

    preferences.setLastTakeHadSound(true);

    setTruncated(recording.truncated);
    setKeptSeconds(recording.seconds);
    await send(recording);
  }

  /**
   * Upload a recording the musician already has.
   *
   * **The picker opens here, from the tap**, because a browser refuses a file
   * picker that a tap did not open — the Upload screen could not open it on
   * arrival. The file is held for that screen (`data/practice/pickedTake`),
   * which shows it and hands it back through `sendQueuedUpload` below.
   */
  async function openUpload() {
    if (recording || isStarting || phase === 'analysing') {
      return;
    }
    setProblem(null);
    const chosen = await chooseAudioFile();
    if (chosen.kind === 'picked') {
      stagePickedFile(params.pieceId, chosen.file);
      navigation.navigate('UploadRecording', { pieceId: params.pieceId });
    } else if (chosen.kind === 'failed') {
      setProblem(chosen.message);
    }
  }

  /**
   * Sends a finished take, keeping it if that fails.
   *
   * Separate from `stop` so a retry runs the same path with the same bytes
   * rather than a second code path that could diverge from the first.
   */
  async function send(recording: {
    audio: Blob;
    filename: string;
    /** Absent for a recorded take, which is always the WAV the app wrote. */
    contentType?: string;
    resume?: TakeSubmissionState;
    /** What the microphone applied. Absent for a picked file. */
    capture?: CaptureReport;
    /**
     * The bar the recording starts on, when it was chosen somewhere other
     * than this screen — the Upload screen's "Start at". A recorded take
     * starts where this screen says.
     */
    fromMeasure?: number;
  }) {
    const entryBar = recording.fromMeasure ?? startFrom;
    // Hold the bytes before the first awaited upload step. This is not yet a
    // visible retry state, but it makes both navigation and browser-exit guards
    // truthful during the vulnerable gap before the server accepts the take.
    unsent.current = recording;
    goPhase('analysing');
    setProblem(null);
    try {
      const analysisId = await takeSubmissionSource.submit({
        // A piece is a score; the id is the same row.
        scoreId: params.pieceId,
        targetBpm,
        metronomeMode,
        audio: recording.audio,
        filename: recording.filename,
        contentType: recording.contentType,
        resume: recording.resume,
        // **Sent, not just applied on the phone.** The metronome counted a
        // shortened piece, so the analysis has to judge a shortened one — see
        // `SubmitTakeInput.skipLongRests` for what happens when it does not.
        skipLongRests: skipRests,
        // Sent, not just applied on the phone: the analysis happens after the
        // response, so the row is the only thing that survives to say which
        // bar was played first.
        fromMeasure: entryBar,
        capture: recording.capture,
      }, { onStage: setAnalysisStage });
      unsent.current = null;
      setPendingTake(false);
      holdForListening(null);
      // The server has it; the device copy is now the only one that could go
      // stale. Not awaited — the verdict is what the musician is waiting for.
      void takeWasAccepted(recording.filename);
      // `/v1/me` carries the remaining monthly allowance. Mark it stale as
      // soon as this analysis finishes so Record again cannot reuse the count
      // from before the take and invite a fourth performance the server will
      // refuse.
      void queryClient.invalidateQueries({ queryKey: meKeys.all });
      navigation.replace('Verdict', { analysisId });
      // The verdict now owns the hand-off. Clear after the navigation is
      // dispatched so a refresh in the gap still recovers the accepted take.
      void forgetPendingAnalysis(analysisId);
    } catch (error) {
      // The quota is the one failure a retry cannot clear — the count does not
      // move until next month, so offering "Send again" would be offering the
      // same refusal. Everything else is worth one tap.
      // One read, so the sentence and the offer of another go cannot
      // disagree — see `lib/audio/takeFailure.ts`.
      const failure = readTakeFailure(error, Platform.OS);
      // A failed step reports the last server-issued key/id it reached. Hold
      // that beside the WAV so retry resumes there rather than paying for the
      // completed upload or creating a second analysis.
      const resumable =
        error instanceof TakeSubmissionError
          ? { ...recording, resume: error.resume }
          : recording;
      unsent.current = failure.retriable ? resumable : null;
      setPendingTake(failure.retriable);
      holdForListening(failure.retriable ? resumable.audio : null);
      if (failure.retriable) {
        // **The ref survives a retry and not a restart.** A musician who
        // records with no signal and backgrounds the app used to lose the
        // performance, which is the one part of this that cannot be repeated.
        void keepTakeForLater(
          resumable,
          {
            scoreId: params.pieceId,
            targetBpm,
            metronomeMode,
            skipLongRests: skipRests,
            fromMeasure: entryBar,
          },
          failure.message,
        );
      }
      // Back to the top of the screen with the tempo still set, so the reply
      // to a failed take is one tap rather than a re-setup.
      setProblem(failure.message);
      // Always false on this path — a send failure is the network or the
      // quota, and neither is fixed by a new document. Set rather than left
      // alone so a reload offered for an earlier microphone failure cannot
      // still be on screen under a sentence about uploading.
      setCanReload(failure.recovery === 'reload' && canReloadPage());
      setElapsedMs(0);
      goPhase('ready');
    }
  }

  async function openMicrophoneSettings() {
    try {
      await Linking.openSettings();
    } catch {
      setProblem(
        'Open your device Settings, choose InTempo, and allow Microphone. Then return and press Start again.',
      );
    }
  }

  const recording = phase === 'recording';
  // **The two of them no longer share a slot, and `footerNote` is gone.**
  // A refused quota and a failed take are about the take in hand, so they stay
  // beside the record button. The allowance notice is about the *next* take,
  // and it sat under the button as two lines of prose splitting the one thing
  // this sheet is for from the settings that configure it. It is at the foot
  // of the sheet now; `visibleProblem` and `lastFreeMessage` are rendered in
  // the two places they belong, and neither has to yield to the other.
  //
  // The reason the failure line is not hidden once recording starts still
  // holds: the record button sits directly under it in a flex column, so
  // dropping a line of text would move the button at the exact moment a thumb
  // is on it, and the count-in would move it a second time.
  const countingIn = phase === 'counting_in';
  const capturing = countingIn || recording;

  /**
   * What the take bar says while the microphone is open.
   *
   * The rule is in `lib/record/takeStatus.ts` with its tests, including the
   * one it exists to hold: it never comments on how loud the playing is.
   */
  const micLine = takeStatus(capturing, hasInputSignal);

  /**
   * Practise the notes without sitting through the rests.
   *
   * Screen-local and defaulting to off, so a take is judged against the whole
   * page unless somebody said otherwise on this screen, this time. Locked once
   * recording starts: the choice changes what the analysis compares against,
   * and changing it mid-take would mean the first half and the second half
   * were played against different pieces.
   */
  const [skipRests, setSkipRests] = useState(false);
  const skippable = useMemo(() => skippableBars(piece?.score), [piece?.score]);
  /** The piece as it will actually be played, heard and judged. */
  const heard = useMemo(
    () =>
      piece?.score && skipRests ? shortenLongRests(piece.score).score : (piece?.score ?? null),
    [piece?.score, skipRests],
  );

  /**
   * Which bar the musician enters on — for the take as well as for Listen.
   *
   * **It used to govern Listen alone**, and the comment here said so: the
   * analysis built its timeline from the whole score, so a take that began at
   * bar 40 would have been compared against bar 1 onward and reported wrong
   * from its first note. The request now carries the bar, migration 015 stores
   * it, and the worker trims the score to match — the same arrangement
   * `skip_long_rests` has, and for the same reason.
   */
  const [chosenStartFrom, setChosenStartFrom] = useState<number | null>(null);
  const insets = useSafeAreaInsets();
  const listenSchedule = useMemo(
    () => (heard ? scheduleScore(heard, targetBpm) : null),
    [heard, targetBpm],
  );
  const startable = useMemo(
    () => (listenSchedule ? startableMeasures(listenSchedule) : []),
    [listenSchedule],
  );
  const startFrom =
    chosenStartFrom !== null && startable.includes(chosenStartFrom)
      ? chosenStartFrom
      : (startable[0] ?? 1);
  const setStartFrom = setChosenStartFrom;

  /**
   * The "Start from" sheet's named places — the top, where the last take
   * stopped short, where it rushed — from the piece's most recent finished
   * take. `startOptions` leaves out any the last take cannot answer.
   */
  const { data: history } = usePieceHistory(params.pieceId);
  const lastTake = history?.recent[0] ?? null;
  const startChoices = useMemo(
    () => startOptions(startable, lastTake),
    [startable, lastTake],
  );
  const [pickingStart, setPickingStart] = useState(false);
  /** Bumped when the sheet picks a bar, so the score scrolls it into view. */
  const [revealStart, setRevealStart] = useState(0);

  /**
   * A file the Upload screen queued with "Send for analysis", sent the moment
   * this screen is back in focus — through `send`, the one path every take
   * takes, so the wait, the failures and "Send it again" are the same for an
   * uploaded file as for a recorded one. `takeQueuedPickedFile` gives it up
   * once, so a second focus cannot send it twice.
   */
  const sendRef = useRef<typeof send | null>(null);
  useFocusEffect(
    useCallback(() => {
      const queued = takeQueuedPickedFile(params.pieceId);
      if (!queued) {
        return;
      }
      setChosenStartFrom(queued.fromMeasure);
      void sendRef.current?.({
        audio: queued.file.audio,
        filename: queued.file.filename,
        contentType: queued.file.contentType,
        fromMeasure: queued.fromMeasure,
      });
    }, [params.pieceId]),
  );
  // `send` is a function declaration, so it exists here; the ref is how the
  // focus callback above reaches the current render's copy.
  sendRef.current = send;

  /** The first bar with a note in it, which is what the pre-flight compares to. */
  const firstSoundingBar = startable[0] ?? null;

  /**
   * What the app can actually tell about this take before it is played.
   *
   * Recomputed every render rather than memoised: it is three comparisons over
   * values already in hand, and a stale warning is worse than a cheap one.
   */
  const checks = preflight({
    metronomeMode,
    startFrom,
    firstSoundingBar: firstSoundingBar ?? startFrom,
    lastTakeHeardSound: lastTakeHadSound,
    instrument,
  });

  /**
   * Open it once, on a musician's first take, and only for a real warning.
   *
   * A ref rather than the position of the state, so a warning that appears
   * later — the entry bar moved onto a rest, the metronome switched to audio —
   * cannot throw a full screen over the music while somebody is setting up.
   * They still reach it from "Before you record", which is the door that was
   * always meant to be the way back in.
   */
  const offeredSetup = useRef(false);
  useEffect(() => {
    if (offeredSetup.current || practiceSetupSeen) {
      return;
    }
    offeredSetup.current = true;
    if (hasWarning(checks)) {
      setShowSetup(true);
    } else {
      // Nothing to stop for, so the first take is not interrupted — and it
      // does not ask again on the next one either.
      preferences.setPracticeSetupSeen(true);
    }
  }, [checks, practiceSetupSeen]);

  /**
   * The piece as the take will actually be played: from the entry bar on.
   *
   * **The cues are measured in beats from the first bar played**, so cues
   * computed from the whole score fire at the wrong moments for a take that
   * began partway in — and the count-in would lead into the wrong music. The
   * server trims the same way before it builds the timeline;
   * `fixtures/practice/start_at.json` is the contract between the two.
   */
  const takeScore = useMemo(
    () => (heard ? startFromMeasure(heard, startFrom) : null),
    [heard, startFrom],
  );

  // One written bar in the pulse a musician actually feels, in the meter
  // where this take actually begins. A take starting after a 4/4 → 6/8 change
  // gets two dotted-quarter pulses, not four quarter-note clicks from the
  // score header. `startFromMeasure` carries the standing meter onto its
  // entry bar, and the first bar's own printed change wins.
  const entryTimeSignature = openingTimeSignature(takeScore);
  const pulse = metronomePulse(entryTimeSignature);
  const perBar = pulse?.pulsesPerBar ?? null;

  /**
   * Where the beat says the musician is, for the mark on the page.
   *
   * **Only while recording**, never during the count-in: the count-in is
   * beats before bar one, so a mark during it would sit on a bar nobody is
   * playing yet and start by being wrong.
   *
   * `startable` is the bars that actually sound, in playing order, so its
   * last entry is the last bar there is to point at. `playheadAt` returns
   * null past it rather than pinning the mark to the final bar forever.
   *
   * **It advances at 100ms**, the rate `elapsedMs` already ticks at, which is
   * about four percent of a bar at 92 BPM. Deliberately not given a faster
   * clock of its own: the mark lives inside the engraved SVG, so every tick
   * re-renders the notation, and a take is exactly the moment the JavaScript
   * thread must stay free for the recorder. Whether the stepping is visible,
   * and whether ten notation renders a second cost anything on a real phone,
   * are both device questions - see the PR.
   */
  const playhead =
    recording && perBar && targetBpm
      ? playheadAt({
          elapsedMs,
          bpm: targetBpm,
          beatsPerBar: perBar,
          startFrom,
          lastBar: startable[startable.length - 1] ?? startFrom,
        })
      : null;
  const metronomePlan = useMemo(
    () => buildMetronomePlan(takeScore, targetBpm),
    [takeScore, targetBpm],
  );
  const countInBeats = metronomePlan.countInPulses;

  const restCues = useMemo(
    () => longRestCues(takeScore, skipRests ? 1 : undefined),
    [takeScore, skipRests],
  );

  // **Above the metronome, because the metronome now depends on it.** A rest
  // changes what the same clock produces — it taps when the mode would not,
  // and taps harder — so the cue has to be known before the hook is called.
  // Every input here is already settled by this point.
  const activeRest = recording
    ? restCueAt(restCues, elapsedMs, targetBpm)
    : null;

  // **The count-in is not the metronome setting.** It ticks, taps and counts
  // on screen whatever the take is set to, the way a conductor counts you in —
  // you cannot start together with something that has not given you the beat.
  // What the take may then produce is a different question, and the microphone
  // answers it: see `lib/metronome/countIn.ts`.
  const metronome = useMetronome({
    mode: metronomeMode,
    bpm: targetBpm,
    timeSignature: entryTimeSignature,
    beatPlan: metronomePlan.beats,
    running: capturing,
    countingIn,
    // A rest taps even when the mode would not, and taps harder — see
    // `takeOutputs`. Read from the cue the screen is already showing, so the
    // hand and the eye are given the same beat by the same source.
    resting: activeRest !== null,
  });

  // Hoisted out of the effect so the dependency below is the value the effect
  // actually uses. Depending on `metronome.beat` itself would re-run this on
  // every beat object the clock emits, including the ones before the count is
  // up — same outcome today, and one refactor away from not being.
  const beatIndex = metronome.beat?.index ?? null;

  // **Bring back a take an earlier session could not send.**
  //
  // Once, on mount, and only into an idle screen with nothing in hand: a live
  // recording or a take already waiting is newer than anything on disk, and
  // overwriting either with a restored one would discard the performance the
  // musician is actually looking at.
  //
  // `restoreQueuedTake` drops an entry whose bytes are gone rather than
  // returning it, so this cannot offer "Send it again" for a take that is not
  // there any more.
  useEffect(() => {
    let cancelled = false;
    void restoreQueuedTake(params.pieceId).then((restored) => {
      if (cancelled || !restored || unsent.current !== null) {
        return;
      }
      unsent.current = {
        audio: restored.audio,
        filename: restored.filename,
        resume: restored.resume,
        capture: restored.capture,
      };
      setPendingTake(true);
      holdForListening(restored.audio);
      if (restored.lastError) {
        setProblem(restored.lastError);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [params.pieceId]);

  useEffect(() => {
    if (!countInIsOver({ countingIn, beatIndex, countInBeats })) {
      return;
    }
    // Beat N is the downbeat after N count-in beats. Keeping the metronome
    // running across this state change preserves phase exactly.
    //
    // **The pre-roll goes here.** The microphone has been open since before
    // the count — deliberately, so no hardware start-up delay lands between
    // "four" and the downbeat — which means the count-in's clicks are in the
    // capture, and `alignment.py` measures every onset from the first one it
    // detects. Dropping what has been captured makes the file begin where the
    // music does, and is what lets the count-in be audible at all.
    recorder.current?.discardCapturedSoFar();
    setElapsedMs(0);
    goPhase('recording');
  }, [countInBeats, countingIn, beatIndex]);

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
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  if ((piece.score?.measures.length ?? 0) === 0) {
    const reading =
      piece.transcriptionStatus === 'queued' ||
      piece.transcriptionStatus === 'reading';
    return (
      <ScreenContainer>
        <EmptyState
          title={reading ? 'Sheet music is still being read' : 'Add sheet music before recording'}
          description={
            reading
              ? 'Practice recording will be ready as soon as the notation appears.'
              : 'InTempo needs the written notes and rests to align your take and produce an accurate analysis.'
          }
          actionLabel="Open piece"
          onActionPress={() =>
            navigation.replace('PieceDetail', { pieceId: piece.id })
          }
        />
      </ScreenContainer>
    );
  }

  if (showSetup) {
    return (
      <PracticeSetup
        title={piece.title}
        checks={checks}
        onResolve={(to) => {
          // Both remedies live on the recording screen, so the way to offer
          // them is to go there — with the metronome already switched, since
          // that one has a single sensible answer and making a musician hunt
          // for it is the reason nobody reads a warning twice.
          if (to === 'metronome') {
            preferences.setMetronomeMode('visual');
          } else if (firstSoundingBar !== null) {
            setStartFrom(firstSoundingBar);
          }
          preferences.setPracticeSetupSeen(true);
          setShowSetup(false);
        }}
        onBack={() => {
          if (practiceSetupSeen) {
            setShowSetup(false);
          } else {
            goBack();
          }
        }}
        onContinue={() => {
          preferences.setPracticeSetupSeen(true);
          setShowSetup(false);
        }}
      />
    );
  }

  if (phase === 'counting_in') {
    /**
     * The beat being counted, the way a conductor counts it: **up**.
     *
     * This was `countInBeats - beat.index` — a countdown — while the dots below
     * it fill left to right. So on the last click of the bar the screen showed
     * a large **1** with the *fourth* dot lit, and a musician glancing at it
     * could read "beat one" and come in a whole beat early. On an app whose
     * entire job is measuring whether you came in on time, that is the one
     * mistake the count-in must not invite.
     *
     * Counting up also matches the two things already on the screen: the dots,
     * and "Start on the next downbeat" — which is a sentence about the beat
     * *after* four, not about a countdown reaching zero. A conductor never
     * counts down.
     */
    const counted = Math.min(countInBeats, (metronome.beat?.index ?? 0) + 1);
    return (
      <ScreenContainer
        scrollable={false}
        bleed
        contentStyle={styles.countInScreen}
      >
        {/*
          **The whole display, and nothing on it but the count**
          (`redesign/RecordCountIn.dc.html`). This is read from across a room
          by someone with an instrument already up, so everything that is not
          the count goes and the numeral is the largest thing in the app.

          **Light, where it used to invert.** The Counting In frame made this
          the one dark moment on the screen; the redesign draws it on the
          page's own ivory, and the owner pinned the app light (2026-09-23).
          The numeral's size does the work the inversion did.
        */}
        <View style={styles.countIn}>
          <Text
            variant="sectionLabel"
            color="textTertiary"
            style={styles.countInLabel}
            accessibilityElementsHidden
          >
            {perBar === null ? 'Four-beat count-in' : 'One-bar count-in'}
          </Text>
          <Text style={styles.countInNumber} accessibilityLiveRegion="polite">
            {counted}
          </Text>
          <BeatIndicator beat={metronome.beat} perBar={perBar} variant="count" />
          <Text variant="body" style={styles.countInCopy}>
            {perBar === null ? 'Start after the count' : 'Start on the next downbeat'}
          </Text>
          {metronome.silent ? (
            <Text variant="metadataSmall" color="textTertiary" style={styles.countInCopy}>
              Haptics are off. Follow the visual count.
            </Text>
          ) : null}
        </View>

        {/*
          One way out, and it is the only control on the screen: small and
          low, because it is the thing *not* to press. A back chevron and a
          cancel button would be two ways to do the same thing.
        */}
        <View style={[styles.countInFooter, { paddingBottom: 36 + insets.bottom }]}>
          <Pressable
            onPress={cancelCountIn}
            accessibilityRole="button"
            accessibilityLabel="Cancel count-in"
            style={({ pressed }) => [styles.countInCancel, pressed && styles.countInCancelPressed]}
          >
            <Text variant="metadata" style={styles.countInCancelLabel}>
              Cancel count-in
            </Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  if (phase === 'analysing') {
    /*
      **Three things move here, and each of them is true.**

      This was a title and one line of static text, held for the whole run —
      about 150 seconds against the deployed instance. Nothing on it changed,
      so it was indistinguishable from a hang, and that is what was reported.

      The bar advances on legs the runner actually reports (`waitProgress`),
      the clock counts real elapsed seconds, and the indicator says the app is
      still asking. None of the three is a timer dressed as progress: where
      there is no leg to place — an older deployment, a run not yet picked up —
      the bar is *absent* rather than empty, because an empty bar claims "no
      progress yet", which is both more than the app knows and the exact
      reading this screen exists to avoid.

      One dominant focal point (§3 law 4): the title. The rail is a hairline
      the width of the text column, the clock is tertiary metadata, and the
      long-wait line appears only when it has something to add.
    */
    const { label, through } = progressFor(analysisStage);
    return (
      <ScreenContainer scrollable={false} contentStyle={styles.centred}>
        <View>
          <Text variant="heroTitle">Listening back</Text>
          <Text variant="body" color="textSecondary" style={styles.subtitle}>
            {truncated
              ? `Only the first ${Math.floor(keptSeconds / 60)} minutes were kept. ${label}.`
              : `${label}.`}
          </Text>
          {through === null ? null : (
            /*
              **The role goes on the rail, not on a wrapper round the text.**
              `role="progressbar"` with a label overrides its own content for a
              screen reader, so wrapping the title and the line in one hid both
              and announced a name instead. The rail carries the role and the
              leg is in its name — `accessibilityValue` is dropped entirely by
              react-native-web, checked on the built bundle, so nothing here
              may depend on it — and the sentence above stays ordinary text
              that is read as ordinary text.
            */
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={`Analysing your take: ${label}`}
              style={styles.waitTrack}
            >
              <View style={[styles.waitFill, { width: `${through * 100}%` }]} />
            </View>
          )}
          <View style={styles.waitFoot}>
            <ActivityIndicator size="small" color={colors.textTertiary} />
            <Text variant="metadata" color="textTertiary">
              {elapsedLabel(waitingMs)}
            </Text>
          </View>
          {isTakingLong(waitingMs) ? (
            <Text
              variant="metadata"
              color="textTertiary"
              style={styles.subtitle}
            >
              Still going. A long take and a busy server both look like this.
              Your recording is safe either way.
            </Text>
          ) : null}
        </View>
      </ScreenContainer>
    );
  }

  /**
   * The redesign's Record screen (`redesign/RecordReady.dc.html`, 2026-09-23):
   * the piece's title, the music in a white band that scrolls, and a fixed
   * panel under it holding Listen, the three settings and the record button.
   *
   * **This retires the Sheet Up frame** (`DECISIONS.md`, 2026-09-16), in which
   * the score filled the display and the settings lived on a sheet dragged
   * over it. The owner's redesign gives each its own band instead: the music
   * is never covered, so it needs no paging readout, and the record button
   * sits in a panel that nothing moves — which was the lesson of 2026-09-20,
   * kept.
   *
   * **During a take the panel changes, the frame does not.** The settings are
   * written onto the take the moment it starts, so they give way to the clock,
   * the beat and what the microphone hears; the record button stays exactly
   * where it was, because it is reached for without looking (§3 law 7).
   */
  return (
    <ScreenContainer scrollable={false} bleed contentStyle={styles.stage}>
      <View style={styles.header}>
        <BackLink label="Back to the piece" onPress={goBack} />
        <View style={styles.titleRow}>
          <Text variant="heroTitle" style={styles.title} numberOfLines={2}>
            {piece.title}
          </Text>
          {/*
            The two doors that are not settings — upload a take you already
            have, and the pre-flight checks. Gone during a take, like every
            other control that cannot change it.
          */}
          {!capturing ? (
            <Pressable
              onPress={() => setShowMore(true)}
              accessibilityRole="button"
              accessibilityLabel="More"
              style={({ pressed }) => [styles.more, pressed && styles.morePressed]}
            >
              <MoreVertical size={20} strokeWidth={2.4} color={colors.textSecondary} />
            </Pressable>
          ) : (
            // The slot stays, empty, so the title does not re-wrap — and move
            // the music under it — the moment a take begins.
            <View style={styles.more} />
          )}
        </View>
      </View>

      {heard ? (
        <ScoreScroll
          score={heard}
          bars={startable}
          startFrom={startFrom}
          onStartFromChange={setStartFrom}
          playhead={playhead}
          revealSignal={revealStart}
          // The entry bar is written onto the take, so it locks with the
          // tempo and the mode the moment recording starts.
          disabled={recording || isStarting}
        />
      ) : null}

      <View style={[styles.panel, { paddingBottom: spacing['2xl'] + insets.bottom }]}>
        {!capturing && heard ? (
          <>
            <ListenPlayer
              score={heard}
              bpm={targetBpm}
              startFrom={startFrom}
              disabled={isStarting}
            />
            <View style={styles.playerGap} />

            {/*
              **The tempo is chosen on its own screen**, and this only shows
              what was chosen — the redesign's split. `practiceTempo` is the
              shared state both read, so coming back shows the new number with
              no hand-off.
            */}
            <PillRow
              label="Tempo"
              value={`${displayedBpm} ${tempoUnitLabel(tempoBeatUnit)}`}
              chevron="right"
              onPress={() => navigation.navigate('Tempo', { pieceId: params.pieceId })}
              accessibilityLabel={`Tempo ${displayedBpm} ${tempoUnitLabel(tempoBeatUnit)}. Change it`}
            />
            {/*
              **One bar for both**, which is what makes it safe to say so. The
              take carries this bar to the server, which trims the score before
              building its timeline — so hearing the passage and recording it
              start in the same place, and the analysis is told which.
            */}
            <PillRow
              // The words say the bar governs the take — `entryCopy`.
              label={entryRowLabel('take')}
              sub="Or tap a bar in the score"
              value={`Bar ${startFrom}`}
              chevron="down"
              onPress={() => setPickingStart(true)}
              accessibilityLabel={entryAccessibilityLabel('take', startFrom)}
            />
            <PillRow
              label="Metronome"
              value={metronomeValueLabel(metronomeMode)}
              chevron="down"
              onPress={() => setPickingMetronome(true)}
              accessibilityLabel={`Metronome ${metronomeValueLabel(metronomeMode)}. Choose how the beat is marked`}
              last={skippable === 0}
            />
            {/*
              Only where there is something to skip — a control that is always
              there and does nothing on most pieces teaches a musician to stop
              reading the controls. The redesign does not draw it because its
              sample piece has no long rests; a piece that does needs it, or the
              take is judged against rests it skipped.
            */}
            {skippable > 0 ? (
              <View style={styles.lastRow}>
                <ToggleRow
                  label={`Skip ${skippable} ${skippable === 1 ? 'bar' : 'bars'} of rest`}
                  value={skipRests}
                  onChange={setSkipRests}
                />
              </View>
            ) : null}

            {/*
              **A feature named in the settings and connected to nothing was
              worse than a missing feature**: haptics off in Profile with the
              mode set to haptic marks no beat at all.
            */}
            {metronome.silent ? (
              <Text variant="caption" color="textTertiary" style={styles.note}>
                Haptics are turned off in your profile, so nothing is marking the
                beat.
              </Text>
            ) : null}
          </>
        ) : null}

        {capturing ? (
          <View style={styles.takeStatus}>
            {activeRest ? (
              <RestCue state={activeRest} />
            ) : (
              <Text
                variant="screenTitle"
                color={elapsedMs > 0 || recording || countingIn ? 'textPrimary' : 'textTertiary'}
                style={styles.timer}
              >
                {formatElapsed(elapsedMs)}
              </Text>
            )}
            {recording && metronomeMode === 'visual' ? (
              <BeatIndicator beat={metronome.beat} perBar={perBar} />
            ) : null}
            {/*
              What the panel says while the microphone is open —
              `lib/record/takeStatus.ts`, where it is tested, including the
              thing it must never say. The detector is amplitude-invariant
              (`TUNING_LOG.md`, 2026-09-02), so a screen that comments on level
              is asking for something that changes nothing.
            */}
            {micLine.line ? (
              <Text
                variant="metadataSmall"
                color={micLine.wrong ? 'textPrimary' : 'textSecondary'}
              >
                {micLine.line}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/*
          **The one failure the app cannot fix gets directions, not a
          sentence.** A refused microphone is followed with a permissions
          panel open on top of the app, a line at a time — so it is the one
          place a numbered list earns its keep. The spoken line is the same
          words, from `microphonePermissionRecovery`.
        */}
        {microphoneBlocked && visibleProblem ? (
          <View
            accessible
            accessibilityLabel={microphoneRecovery.message}
            style={styles.problem}
          >
            <Text variant="metadataSmall" color="textSecondary">
              {microphoneRecovery.headline}
            </Text>
            {microphoneRecovery.steps.map((step, index) => (
              <View key={step} style={styles.step}>
                <Text variant="metadataSmall" color="textTertiary" style={styles.stepNumber}>
                  {index + 1}
                </Text>
                <Text variant="metadataSmall" color="textSecondary" style={styles.stepText}>
                  {step}
                </Text>
              </View>
            ))}
          </View>
        ) : visibleProblem ? (
          <Text variant="metadataSmall" color="textSecondary" style={styles.problem}>
            {visibleProblem}
          </Text>
        ) : null}

        {/*
          Which build is saying this, shown only beside a failure — on a
          working screen it is noise, on a failing one it is the difference
          between a report worth acting on and another round of guessing.
        */}
        {visibleProblem && marker ? (
          <Text variant="caption" color="textTertiary" style={styles.marker}>
            {marker}
          </Text>
        ) : null}

        {canReload ? (
          <SecondaryButton
            label="Reload and try again"
            onPress={() => {
              reloadPage();
            }}
            style={styles.action}
          />
        ) : null}
        {microphoneBlocked && Platform.OS !== 'web' ? (
          <SecondaryButton
            label="Open microphone settings"
            onPress={() => void openMicrophoneSettings()}
            style={styles.action}
          />
        ) : null}

        {/*
          **Proof, not a claim.** "Your take is safe on this device" is the
          sentence a musician most needs to believe after a failed upload; a
          take they can play is the same thing demonstrated.
        */}
        {pendingTake && heldUrl ? (
          <HeldTakePlayer url={heldUrl} style={styles.action} />
        ) : null}
        {pendingTake ? (
          <SecondaryButton
            label="Send it again"
            onPress={() => {
              const take = unsent.current;
              if (take) {
                void send(take);
              }
            }}
            style={styles.action}
          />
        ) : null}

        <View style={styles.recordGap} />
        <RecordButton
          active={recording}
          countingIn={false}
          busy={isStarting}
          disabled={!recording && Boolean(limitMessage)}
          onPress={() => void (recording ? stop() : start())}
        />

        {/*
          The quota, as a standing note under the button rather than a
          warning: nothing about it changes what a musician does in the next
          five minutes. The failure half of it is `visibleProblem` above.
        */}
        {!capturing && lastFreeMessage ? (
          <Text variant="caption" color="textTertiary" style={styles.quota}>
            {lastFreeMessage}
          </Text>
        ) : null}
      </View>

      <StartFromSheet
        visible={pickingStart}
        options={startChoices}
        startFrom={startFrom}
        onPick={(bar) => {
          setStartFrom(bar);
          setRevealStart((count) => count + 1);
          setPickingStart(false);
        }}
        onClose={() => setPickingStart(false)}
      />
      {/*
        The two doors that do not fit in the column, in the row grammar of the
        ones that do.
      */}
      <BottomSheet
        visible={showMore}
        onClose={() => setShowMore(false)}
        title="More"
      >
        <LinkRow
          label="Upload a recording"
          divided={false}
          onPress={() => {
            setShowMore(false);
            void openUpload();
          }}
          hint={`Choose an audio file you already have. ${ACCEPTED_LABEL} all work.`}
        />
        <LinkRow
          label="Before you record"
          onPress={() => {
            setShowMore(false);
            setShowSetup(true);
          }}
          hint="Opens what the app can tell about this take"
        />
      </BottomSheet>

      {/*
        Every way to mark the beat, on the screen that needs it. Before this
        the mode could only be set in Profile.
      */}
      <BottomSheet
        visible={pickingMetronome}
        onClose={() => setPickingMetronome(false)}
        title="Marking the beat"
      >
        {/*
          **Rows that give, like every other choice list in the app.** These
          were bare `Pressable`s with a background swap and nothing else: no
          scale, no tick, on the one control whose whole job is to be chosen
          between four ways. A choice that looks identical during the press
          reads as dead (§3, "a tap gets an immediate response").
        */}
        {metronomeChoices().map((choice) => (
          <PressableScale
            key={choice.mode}
            activeScale={0.99}
            onPress={() => {
              impact(ImpactFeedbackStyle.Light);
              setPickingMetronome(false);
              preferences.setMetronomeMode(choice.mode);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: choice.mode === metronomeMode }}
            aria-pressed={choice.mode === metronomeMode}
            accessibilityLabel={`${choice.label}. ${choice.detail}`}
            style={({ pressed }) => [
              styles.metronomeOption,
              pressed && styles.metronomePressed,
            ]}
          >
            <Text
              variant="body"
              color={choice.mode === metronomeMode ? 'accentText' : 'textPrimary'}
            >
              {choice.label}
            </Text>
            <Text
              variant="metadataSmall"
              color="textSecondary"
              style={styles.metronomeOptionDetail}
            >
              {choice.detail}
            </Text>
          </PressableScale>
        ))}
      </BottomSheet>

      {/*
        Only this view can raise it: the count-in leaves outright, and by
        `analysing` the audio is already on its way. Both cases that hold
        unsent audio — a live take, and one whose upload failed — are here.
      */}
      <ConfirmDialog
        visible={leavePrompt !== null}
        title={leavePrompt?.title ?? ''}
        message={leavePrompt?.message ?? ''}
        confirmLabel={leavePrompt?.confirmLabel ?? ''}
        cancelLabel={leavePrompt?.cancelLabel}
        onConfirm={confirmLeave}
        onCancel={() => setLeavePrompt(null)}
      />
    </ScreenContainer>
  );
}

/**
 * What the screen says while the score is silent.
 *
 * **A word and a beat, not a timer.** This counted down — bars, then beats,
 * in hero type — and a counting number is the wrong instrument for the job:
 * it makes the rest into a wait, it competes with the record button for the
 * one focal point `CLAUDE.md` §3 law 4 allows, and it tells a musician the
 * one thing they can already work out while leaving out the one they cannot,
 * which is where the beat is right now.
 *
 * So the word **Rest** is the focal point, the pulse is a row of dots that
 * fills across the bar, and the re-entry measure recedes to a line underneath.
 * The dots are the felt pulse of *this* bar, which is what a musician counts —
 * so a meter change inside a rest changes the row, as it should.
 */
function RestCue({ state }: { state: RestCueState }) {
  const inBar = restPulseDots(state);
  const bars = state.barsRemaining;

  return (
    <Card emphasis style={styles.restCue}>
      <Text variant="heroTitle" accessibilityLiveRegion="polite">
        Rest
      </Text>
      <View
        style={styles.restPulseRow}
        // One label for the row: a screen reader announcing eight dots
        // individually, every beat, would bury the screen it is on.
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Beat ${inBar.current + 1} of ${inBar.total}`}
      >
        {inBar.dots.map((filled, index) => (
          <View
            key={index}
            style={[styles.restDot, filled ? styles.restDotOn : null]}
          />
        ))}
      </View>
      <Text variant="body" color="textSecondary" style={styles.restEntry}>
        {bars > 1 ? `${bars} bars · ` : ''}
        come in at measure {state.cue.resumeMeasure}
      </Text>
    </Card>
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
  active,
  countingIn,
  busy = false,
  disabled = false,
  onPress,
}: {
  active: boolean;
  countingIn: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const label = busy ? 'Starting microphone…' : disabled
    ? 'Monthly analysis limit reached'
    : countingIn
      ? 'Cancel count-in'
      : active
        ? 'Stop recording'
        : 'Start recording';
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={[styles.control, disabled && styles.controlDisabled]}
      // More give than the default: this is the one control a musician reaches
      // for without looking, and it has to answer the finger.
      activeScale={0.94}
    >
      {({ pressed }) => (
        <>
          <View style={[styles.record, pressed && styles.recordPressed]}>
            {active ? (
              <Square
                size={ICON_SIZE.lg}
                strokeWidth={ICON_STROKE_WIDTH}
                color={colors.actionText}
                fill={colors.actionText}
              />
            ) : (
              <Mic
                size={30}
                strokeWidth={1.6}
                color={colors.actionText}
              />
            )}
          </View>
          <Text variant="metadata" color="textSecondary">
            {label}
          </Text>
        </>
      )}
    </PressableScale>
  );
}

/** The redesign's record disc: 80pt, a clear step down from the old 88. */
const RECORD_SIZE = 80;

const styles = StyleSheet.create({
  /**
   * Header, the music's band, the panel — a column, top to bottom.
   *
   * `paddingBottom: 0` takes back the container's own bottom inset: the panel
   * runs to the bottom edge and carries `insets.bottom` itself, so the home
   * indicator sits on the panel rather than on a strip of page under it.
   */
  stage: {
    flex: 1,
    paddingBottom: 0,
  },
  header: {
    paddingTop: 14,
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  // A bare glyph, not a ringed button: it is secondary to the title beside
  // it. Flush with the margin, so its 44pt target reaches past it.
  more: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -10,
    marginTop: -6,
  },
  morePressed: {
    opacity: 0.55,
  },
  /**
   * The panel under the music: `panel`, a step warmer than a card, with a
   * hairline where it meets the score. It is what the thumb reaches, so the
   * record button lives here and nothing ever moves it.
   */
  panel: {
    backgroundColor: colors.panel,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing['2xl'],
  },
  playerGap: {
    height: 14,
  },
  lastRow: {
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  recordGap: {
    height: 10,
  },
  /** During a take, in place of the settings: the clock, the beat, the mic. */
  takeStatus: {
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  action: {
    marginTop: spacing.md,
  },
  centred: {
    justifyContent: 'center',
  },
  /** The count-in: the page's own ground, the count centred on it. */
  countInScreen: {
    flex: 1,
    paddingBottom: 0,
  },
  countIn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 26,
    paddingHorizontal: spacing['2xl'],
  },
  countInLabel: {
    letterSpacing: 0.6,
  },
  // The largest thing in the app, and the only thing on the screen that
  // size: it is read from a music stand.
  countInNumber: {
    fontFamily: fontFamily.serifRegular,
    fontSize: 132,
    lineHeight: 120,
    letterSpacing: -4,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  countInCopy: {
    textAlign: 'center',
  },
  countInFooter: {
    alignItems: 'center',
  },
  countInCancel: {
    height: MIN_TOUCH_TARGET,
    paddingHorizontal: 18,
    borderRadius: MIN_TOUCH_TARGET / 2,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
  },
  countInCancelPressed: {
    backgroundColor: colors.surfacePressed,
  },
  countInCancelLabel: {
    fontFamily: fontFamily.sansMedium,
  },
  restCue: {
    width: '100%',
    alignItems: 'center',
  },
  restPulseRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    // A long bar of many pulses wraps rather than squeezing the dots into a
    // line too fine to read at a music stand.
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  restDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
  },
  restDotOn: {
    backgroundColor: colors.textPrimary,
    // The beat you are on, at the size a glance can find from a stand.
    transform: [{ scale: 1.4 }],
  },
  restEntry: {
    textAlign: 'center',
  },
  timer: {
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  subtitle: {
    marginTop: spacing.md,
  },
  /**
   * The wait's progress rail.
   *
   * A hairline, not a bar with a border and a radius: §3 law 6 keeps rounded
   * containers and borders for exceptions, and this is one line under some
   * text. It takes the text column's width so it reads as belonging to the
   * sentence above rather than as a component dropped beneath it.
   */
  waitTrack: {
    marginTop: spacing.lg,
    height: BORDER_WIDTH * 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  waitFill: {
    height: '100%',
    backgroundColor: colors.textSecondary,
  },
  /** The clock and the live indicator, on one line under the rail. */
  waitFoot: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  /**
   * The ruled row `PlaybackSettings` already draws for "Start at", because
   * this is the same kind of thing: a setting whose value is a word and whose
   * control opens. Consistency is the affordance — someone who has tapped one
   * of these knows this one does something, which the bare label it replaces
   * could not say once its colour had to go for contrast.
   */
  metronomeOption: {
    paddingVertical: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  metronomeOptionDetail: {
    marginTop: 2,
  },
  metronomePressed: {
    backgroundColor: colors.surfacePressed,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  stepNumber: {
    // A fixed column so the three steps' text lines up rather than stepping in
    // and out with the width of the numeral.
    width: spacing.md,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  stepText: {
    flex: 1,
  },
  problem: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  /**
   * Ranged left with the rows it sits under, not centred.
   *
   * It was centred, which under a list whose every label starts at the same
   * left margin reads as a separate remark rather than as the footnote on the
   * list it is a footnote on (§3 law 5: consistent horizontal margins).
   */
  quota: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  // Tucked under the message it belongs to, not spaced as a sibling: it is a
  // footnote on the failure above, and reads as one.
  marker: {
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  /** Under the row it qualifies, ranged left with it. See `quota`. */
  note: {
    marginTop: spacing.sm,
  },
  /*
   * **No margin of its own any more, and that is the third time this has
   * changed for the same reason.** It was 40pt to lift the control off the
   * bottom edge of the screen; then 16pt, when the button was inside the sheet
   * with settings under it and the margin had become a gap before the next
   * row. It is the last thing in the take bar now, so the space below it is
   * the bar's own `paddingBottom` — which also carries `insets.bottom`, and is
   * the only figure here that knows how tall this phone's home indicator is.
   *
   * A margin here would be added to that one and could only be wrong on some
   * device. One owner for one gap.
   */
  control: {
    alignItems: 'center',
    gap: 7,
  },
  controlDisabled: {
    opacity: disabledOpacity,
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
