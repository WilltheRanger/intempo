import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { Mic, Square } from '../../components/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import {
  Card,
  EmptyState,
  LoadingState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { usePiece } from '../../data/hooks/usePieces';
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
import { MicrophonePermissionError, type Recorder } from '../../lib/audio/types';
import { readTakeFailure } from '../../lib/audio/takeFailure';
import { canReloadPage, reloadPage } from '../../lib/platform/reloadPage';
import {
  keepTakeForLater,
  restoreQueuedTake,
  takeWasAccepted,
} from '../../lib/sync/queuedTakes';
import { startRecording } from '../../lib/audioRecorder';
import {
  colors,
  disabledOpacity,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  radii,
  spacing,
} from '../../design';
import { TempoStepper } from '../../components/practice/TempoStepper';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import {
  displayTempoBpm,
  quarterBpmFromDisplay,
  tempoDisplayRange,
  tempoUnitLabel,
} from '../../lib/tempo';
import { metronomePulse, monotonicNow, useMetronome } from '../../lib/metronome';
import { countInIsOver } from '../../lib/metronome/countIn';
import { buildMetronomePlan } from '../../lib/metronome/plan';
import {
  longRestCues,
  restCueAt,
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
import { ListenButton } from '../../components/score/ListenButton';
import { PlaybackSettings } from '../../components/score/PlaybackSettings';
import { scheduleScore, startableMeasures } from '../../lib/score';
import { startFromMeasure } from '../../lib/score/startFrom';
import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import {
  leavingRecord,
  shouldGuardBrowserExit,
  type RecordPhase,
} from '../../lib/record/leaving';
import { useGoBack } from '../../navigation/useGoBack';
import { loadStateFor } from '../../lib/loadState';

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
  const { instrument, metronomeMode, practiceSetupSeen } = usePreferences();

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
  const displayedRange = tempoDisplayRange(tempoBeatUnit);
  const [phase, setPhase] = useState<Phase>('ready');
  // The first recording on this device gets a short orientation before the
  // system permission prompt. It can always be reopened from the ready screen.
  const [showSetup, setShowSetup] = useState(!practiceSetupSeen);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [hasInputSignal, setHasInputSignal] = useState(false);
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'counting_in') return;
    const timer = setInterval(() => {
      setHasInputSignal((recorder.current?.inputPeak?.() ?? 0) > 0);
    }, 200);
    return () => clearInterval(timer);
  }, [phase]);
  const [problem, setProblem] = useState<string | null>(null);
  const lastFreeMessage = describeLastFreeAnalysis(musician?.usage);
  const visibleProblem = limitMessage ?? problem;
  const [microphoneBlocked, setMicrophoneBlocked] = useState(false);
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
    resume?: TakeSubmissionState;
  } | null>(null);
  const [pendingTake, setPendingTake] = useState(false);
  /** The open "you are about to lose this" dialog, or null. */
  const [leavePrompt, setLeavePrompt] = useState<
    Extract<ReturnType<typeof leavingRecord>, { kind: 'confirm' }> | null
  >(null);

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
      goPhase('ready');
      return;
    }

    setTruncated(recording.truncated);
    setKeptSeconds(recording.seconds);
    await send(recording);
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
    resume?: TakeSubmissionState;
  }) {
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
        resume: recording.resume,
        // **Sent, not just applied on the phone.** The metronome counted a
        // shortened piece, so the analysis has to judge a shortened one — see
        // `SubmitTakeInput.skipLongRests` for what happens when it does not.
        skipLongRests: skipRests,
        // Sent, not just applied on the phone: the analysis happens after the
        // response, so the row is the only thing that survives to say which
        // bar was played first.
        fromMeasure: startFrom,
      });
      unsent.current = null;
      setPendingTake(false);
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
            fromMeasure: startFrom,
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

  function toggleMetronome() {
    impact(ImpactFeedbackStyle.Light);
    preferences.setMetronomeMode(
      metronomeMode === 'off' ? lastOnMode.current : 'off',
    );
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
  // **One slot, two senders, and the allowance notice yields.** A refused quota
  // and a failed take are both about the take in hand; this is about the next
  // one, so it never takes the slot from either.
  //
  // It is *not* hidden once recording starts, though it has nothing left to
  // decide by then. The record button sits directly under this line in a flex
  // column, so dropping two lines of text moves the button at the exact moment
  // a thumb is on it — and the count-in would move it a second time. The
  // sentence stays true for the whole take, and the take ending leaves this
  // screen anyway.
  const footerNote = visibleProblem ?? lastFreeMessage;
  const countingIn = phase === 'counting_in';
  const capturing = countingIn || recording;

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
  const metronomePlan = useMemo(
    () => buildMetronomePlan(takeScore, targetBpm),
    [takeScore, targetBpm],
  );
  const countInBeats = metronomePlan.countInPulses;

  const restCues = useMemo(
    () => longRestCues(takeScore, skipRests ? 1 : undefined),
    [takeScore, skipRests],
  );

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
      };
      setPendingTake(true);
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

  const activeRest = recording
    ? restCueAt(restCues, elapsedMs, targetBpm)
    : null;

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
        contentStyle={styles.screen}
        footer={
          <RecordButton
            active
            countingIn
            onPress={cancelCountIn}
          />
        }
      >
        <PageHeader
          eyebrow={piece.composer}
          title={piece.title}
          onBack={goBack}
          // **The same words as every other phase of this screen.** It said
          // "Cancel count-in" — which the record button below it also says, so
          // a screen reader announced one label for two controls, and the
          // chevron did something no other chevron in the app does.
          backLabel="Back to the piece"
        />

        <View style={styles.countIn}>
          <Text variant="sectionLabel" color="textSecondary">
            {perBar === null ? 'Four-beat count-in' : 'One-bar count-in'}
          </Text>
          <Text
            variant="heroTitle"
            style={styles.countInNumber}
            accessibilityLiveRegion="polite"
          >
            {counted}
          </Text>
          <Text variant="body" color="textSecondary" style={styles.countInCopy}>
            {perBar === null ? 'Start after the count' : 'Start on the next downbeat'}
          </Text>
          <BeatIndicator beat={metronome.beat} perBar={perBar} />
          {metronome.silent ? (
            <Text variant="metadataSmall" color="textTertiary" style={styles.note}>
              Haptics are off. Follow the visual count.
            </Text>
          ) : null}
        </View>
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
              ? `Only the first ${Math.floor(keptSeconds / 60)} minutes were kept. Matching them against the score.`
              : 'Matching what you played against the score.'}
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer
      // **Scrolls, because the footer can grow and this body cannot shrink.**
      // The footer is a flex sibling of a `flex: 1` content view, so every
      // line the problem message gains is a line taken off the body — whose
      // rows have fixed heights and therefore clip rather than reflow. On
      // 2026-09-12 a four-line microphone failure sliced "Recording tips" in
      // half on a real phone.
      //
      // The two other states on this screen stay non-scrolling on purpose:
      // they hold a title and a control, and nothing can push them over a
      // viewport. This one holds a tempo stepper, four rows and a message
      // whose length is decided by whatever the browser refused.
      //
      // The record button does not move: it is in the footer, which sits
      // outside the scroll area and keeps the thumb zone `CLAUDE.md` §3 law 7
      // asks for.
      contentStyle={styles.screen}
      footer={
        <View style={styles.footer}>
          {footerNote ? (
            <Text
              variant="metadataSmall"
              color="textSecondary"
              style={styles.problem}
            >
              {footerNote}
            </Text>
          ) : null}
          {/*
            The page's own remedy, offered rather than described.

            The sentence above says the document needs reloading; before this
            the only reload it named was "pull down to refresh", on a screen
            with `scrollable={false}`, inside a home-screen app with no address
            bar. Both routes were absent. This one is the page reloading
            itself, which has always been possible — see
            `lib/platform/reloadPage.ts`.
          */}
          {canReload ? (
            <SecondaryButton
              label="Reload and try again"
              onPress={() => {
                reloadPage();
              }}
              style={styles.permissionAction}
            />
          ) : null}
          {microphoneBlocked && Platform.OS !== 'web' ? (
            <SecondaryButton
              label="Open microphone settings"
              onPress={() => void openMicrophoneSettings()}
              style={styles.permissionAction}
            />
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
            active={recording}
            countingIn={false}
            busy={isStarting}
            disabled={!recording && Boolean(limitMessage)}
            onPress={() => void (recording ? stop() : start())}
          />
        </View>
      }
    >
      <PageHeader
        eyebrow={piece.composer}
        title={piece.title}
        onBack={goBack}
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
            bpm={displayedBpm}
            unitLabel={tempoUnitLabel(tempoBeatUnit)}
            minBpm={displayedRange.min}
            maxBpm={displayedRange.max}
            onChange={(next) =>
              practiceTempo.set(
                params.pieceId,
                quarterBpmFromDisplay(next, tempoBeatUnit),
              )
            }
            disabled={recording}
          />

          {markingBpm !== null && marking ? (
            <Text
              variant="metadataSmall"
              color="textSecondary"
              style={styles.bassNote}
            >
              The page is marked {marking} and gives no metronome mark. This is
              what that usually means — move it to what you play.
            </Text>
          ) : null}

          {instrument === 'double_bass' ? (
            <Text
              variant="metadataSmall"
              color="textSecondary"
              style={styles.bassNote}
            >
              Double-bass detection is on. Keep the microphone uncovered and
              give bowed attacks a clear start.
            </Text>
          ) : null}

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
              // Ink when live, metadata grey when locked during a take. It
              // was gold, because gold was what a tappable label looked like
              // everywhere in the app — but at 13px the accent is 3.54:1,
              // under the 4.5:1 floor, so nothing is gold text any more. The
              // word still carries on or off; the weight of the colour says
              // whether the line does anything.
              color={recording ? 'textTertiary' : 'textPrimary'}
            >
              {METRONOME_LABELS[metronomeMode]}
            </Text>
          </Pressable>
          )}

          {/*
            Only where there is something to skip — a control that is always
            there and does nothing on most pieces teaches a musician to stop
            reading the controls. It names the number of bars, because "skip
            long rests" is not a question anybody can answer about a page they
            have not counted.

            Locked with the tempo and the mode once recording starts, and for a
            stronger reason than either: it changes what the analysis compares
            the take against, so flipping it mid-take would mean the first half
            and the second half were played against different pieces.
          */}
          {skippable > 0 ? (
            <Pressable
              onPress={() => setSkipRests((on) => !on)}
              disabled={recording}
              accessibilityRole="switch"
              aria-checked={skipRests}
              aria-disabled={recording}
              accessibilityLabel="Skip long rests"
              style={({ pressed }) => [
                styles.metronome,
                pressed && styles.metronomePressed,
              ]}
            >
              <Text
                variant="metadataSmall"
                color={recording ? 'textTertiary' : 'textPrimary'}
              >
                {skipRests
                  ? `Skipping ${skippable} bars of rest`
                  : `Skip ${skippable} bars of rest`}
              </Text>
            </Pressable>
          ) : null}

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
            // **What you are about to play**, which is the whole point of
            // listening before a take. With the rests skipped it has to play
            // them skipped, or the preview rehearses a different piece from
            // the one the metronome is about to count and the analysis is
            // about to judge.
            score={heard}
            bpm={targetBpm}
            fromMeasure={startFrom}
            // Silenced the moment a take starts: anything through the speaker
            // lands in the microphone as phantom onsets (§4).
            disabled={recording || isStarting}
          />

          {/* **One bar for both**, which is what makes it safe to say so. The
              take carries this bar to the server, which trims the score before
              building its timeline — so hearing the passage and recording it
              now start in the same place, and the analysis is told which. */}
          <PlaybackSettings
            entry="take"
            score={heard}
            bars={startable}
            fromMeasure={startFrom}
            onFromMeasureChange={setStartFrom}
            bpm={targetBpm}
            beatUnit={tempoBeatUnit}
            disabled={recording}
          />

          {!recording ? (
            <Pressable
              onPress={() => setShowSetup(true)}
              accessibilityRole="button"
              accessibilityLabel="Open recording tips"
              style={({ pressed }) => [
                styles.metronome,
                pressed && styles.metronomePressed,
              ]}
            >
              <Text variant="metadataSmall" color="textPrimary">
                Recording tips
              </Text>
            </Pressable>
          ) : null}
        </View>

        {activeRest ? (
          <RestCountdown state={activeRest} />
        ) : (
          <Text
            variant="screenTitle"
            /*
             * **Ink while it is counting, quiet while it reads 00:00.**
             *
             * Before a take the screen had two things set in its largest type
             * — the tempo and a timer showing zero — plus the record button, so
             * the eye had three places to land and design law 4 asks for one.
             * The timer is the one carrying no information yet.
             *
             * Dimmed rather than removed, and that is the whole point. `body`
             * distributes with `space-evenly` and this node reserves the height
             * the running timer needs; taking it out redistributes the screen
             * and everything above it moves **at the instant the count-in
             * starts** — when a musician has an instrument up and is watching
             * for the downbeat. Measured: removing it leaves a visible void
             * between the settings and the button, which is a worse trade than
             * the numeral it removes.
             */
            color={elapsedMs > 0 || recording || countingIn ? 'textPrimary' : 'textTertiary'}
            style={styles.timer}
          >
            {formatElapsed(elapsedMs)}
          </Text>
        )}
        {capturing ? (
          <Text variant="metadataSmall" color="textSecondary">
            {hasInputSignal
              ? 'Microphone: audio received'
              : 'Microphone: waiting for sound'}
          </Text>
        ) : null}
      </View>

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

function RestCountdown({ state }: { state: RestCueState }) {
  const finalBar = state.barsRemaining === 1;
  const value = finalBar
    ? state.beatsRemainingInBar
    : state.barsRemaining;
  const unit = finalBar
    ? value === 1
      ? 'beat to entry'
      : 'beats to entry'
    : 'bars to entry';

  return (
    <Card emphasis style={styles.restCue}>
      <Text variant="sectionLabel" color="textSecondary">
        Rest · come in at measure {state.cue.resumeMeasure}
      </Text>
      <Text
        variant="heroTitle"
        style={styles.restCueNumber}
        accessibilityLiveRegion="polite"
      >
        {value}
      </Text>
      <Text variant="body" color="textSecondary">
        {unit}
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
                size={ICON_SIZE.lg}
                strokeWidth={ICON_STROKE_WIDTH}
                color={colors.actionText}
              />
            )}
          </View>
          <Text variant="metadata">{label}</Text>
        </>
      )}
    </PressableScale>
  );
}

const RECORD_SIZE = 88;

const styles = StyleSheet.create({
  screen: {
    // **`flexGrow`, not `flex`.** This is a `contentContainerStyle` now, and
    // `flex: 1` on one pins the content to exactly the viewport height: it
    // cannot report being taller than the box that holds it, so the children
    // spill out and are clipped while the ScrollView believes everything fits.
    //
    // Measured rather than reasoned about, after the fix for the clipping did
    // not clip any less. `onContentSizeChange` reported **495 against a 495
    // viewport** while the DOM's own `scrollHeight` was **518** — the
    // ScrollView was being told its content was exactly as tall as itself.
    // That is one cause for both halves of what shipped: nothing scrolled, and
    // `measureOverflow` could never be true, so the hairline that marks
    // content passing under the footer never appeared and the cut looked like
    // breakage rather than like a fold.
    //
    // `flexGrow: 1` fills the screen when the content is short — which is what
    // the old value was there for — and lets it grow past it when it is not.
    flexGrow: 1,
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
  countIn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countInNumber: {
    marginTop: spacing.xl,
    fontVariant: ['tabular-nums'],
  },
  countInCopy: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  restCue: {
    width: '100%',
    alignItems: 'center',
  },
  restCueNumber: {
    marginTop: spacing.md,
    fontVariant: ['tabular-nums'],
  },
  bassNote: {
    maxWidth: 320,
    textAlign: 'center',
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
  permissionAction: {
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
