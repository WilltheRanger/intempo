import { audioContext, resumeAudio } from './audio/context.web';
import { prepareForPlayback } from './audio/session.web';
import type { Schedule } from './score/schedule';
import {
  DEFAULT_VOICE,
  harmonicsFor,
  VOICES,
  type VoiceName,
} from './score/voice';
import type { PlaybackHandle, PlayOptions } from './score/player.types';
import { beginSampledPlayback } from './score/sampledPlayback';

/**
 * Playing a score in a browser, with Web Audio.
 *
 * Every note is scheduled up front against `audioContext.currentTime` rather
 * than fired from timers. The audio clock runs on its own thread and doesn't
 * drift; `setTimeout` drifts by tens of milliseconds over a minute, which is
 * the same order as the deviations this whole app exists to measure. A
 * playback reference that wanders is worse than none.
 *
 * The playhead is the one thing that does use a frame loop — it only has to
 * be right to the frame, and it reads the audio clock rather than counting.
 * It is not, however, allowed to be the only thing that notices the end: see
 * `sweepForEnd`.
 */

/**
 * How far past the computed end the sweep waits before looking again.
 *
 * Small and only there so a wake-up a millisecond early re-arms once instead of
 * spinning. The check itself is against the audio clock, so this is slack, not
 * a schedule.
 */
const END_SWEEP_SLACK_MS = 50;

/**
 * How long to give the audio clock to start moving, in wall-clock ms.
 *
 * **The failure this catches is a context that never runs.** `resume()` is a
 * promise nobody awaits and a browser may simply refuse it — Safari parks a
 * context in `interrupted` after a phone call, another app, or the page being
 * backgrounded, and a context created outside a gesture is born `suspended`.
 * When that happens `currentTime` is frozen, so *both* end conditions fail
 * open: `tick` compares against a value that never grows, and `sweepForEnd`
 * deliberately re-checks the audio clock and re-arms. The button says Stop for
 * a piece that never started, forever, and pressing it stops silence.
 *
 * Measured against **wall** time on purpose. The audio clock is the thing
 * under suspicion, so it cannot also be the judge.
 */
const START_TIMEOUT_MS = 2000;

/** How often to look, while waiting for it. */
const START_POLL_MS = 120;

/** Schedule and play a score, returning a handle that can stop it. */
export function playSchedule(
  schedule: Schedule,
  {
    voice = DEFAULT_VOICE,
    onProgress,
    onEnd,
    onLoading,
    onError,
  }: PlayOptions = {},
): PlaybackHandle {
  // Asked in this order on purpose: a score with nothing in it must not be the
  // thing that spends the page's one audio context. Building it is otherwise
  // free, but on iOS a context is a capped resource and this branch is reached
  // by every screen that renders a Listen for a piece still being read.
  //
  // A schedule that cannot be *measured* is refused in the same breath and for
  // a sharper reason: every comparison against `NaN` is false, so `tick` never
  // reaches the end and `sweepForEnd` re-arms forever. Nothing sounds, the
  // button stays on Stop, and the only way out is to press it twice. One
  // non-finite tempo reaching `scheduleScore` did that.
  if (
    schedule.notes.length === 0 ||
    !Number.isFinite(schedule.durationS) ||
    schedule.durationS <= 0
  ) {
    onEnd?.();
    return { stop: () => {}, isPlaying: () => false };
  }

  const maybeContext = audioContext();
  if (!maybeContext) {
    onError?.(
      'Audio is unavailable in this browser. Please try Safari or Chrome.',
    );
    onEnd?.();
    return { stop: () => {}, isPlaying: () => false };
  }

  // **Shared, and asked to run before anything is scheduled.** A context per
  // playback is the commonest "audio works once on iPhone" bug there is — see
  // `lib/audio/context.web.ts`. Resuming inside the tap is what makes the
  // *first* one audible; sharing it is what makes the second one work.
  const context = maybeContext;
  void prepareForPlayback();
  resumeAudio(context);

  if (voice !== 'reference') {
    return beginSampledPlayback(
      schedule,
      voice,
      { onProgress, onEnd, onLoading, onError },
      async (audio, cancelled, finish) => {
        if (cancelled()) return () => {};
        const buffer = context.createBuffer(
          audio.channels,
          audio.pcm.length / audio.channels,
          audio.sampleRate,
        );
        for (let c = 0; c < audio.channels; c++) {
          const channel = buffer.getChannelData(c);
          for (let i = 0; i < channel.length; i++)
            channel[i] = audio.pcm[i * audio.channels + c] / 32768;
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const startedAt = context.currentTime + 0.08;
        let visibleSince = Date.now();
        let timer: ReturnType<typeof setInterval> | undefined;
        const cleanup = () => {
          clearInterval(timer);
          source.onended = null;
          try {
            source.stop();
          } catch {
            /* Already ended. */
          }
          source.disconnect();
        };
        try {
          source.onended = finish;
          source.start(startedAt);
          timer = setInterval(() => {
            const elapsed = context.currentTime - startedAt;
            if (elapsed >= audio.durationS) {
              finish();
              return;
            }
            if (elapsed <= 0) {
              if (typeof document !== 'undefined' && document.hidden)
                visibleSince = Date.now();
              if (Date.now() - visibleSince > START_TIMEOUT_MS) {
                onError?.('Audio couldn’t start. Tap Listen to try again.');
                finish();
                return;
              }
              resumeAudio(context);
            }
            onProgress?.(
              Math.min(schedule.durationS, Math.max(0, elapsed)),
              schedule.durationS,
            );
          }, 50);
        } catch (error) {
          cleanup();
          throw error;
        }
        return cleanup;
      },
    );
  }

  const spec = VOICES[voice as VoiceName] ?? VOICES[DEFAULT_VOICE];

  // Headroom. The partials are normalised to sum to one, so the worst case
  // is a peak of one per note; this leaves room for notes overlapping through
  // their release tails.
  const master = context.createGain();
  master.gain.value = spec.gain;
  master.connect(context.destination);

  const startedAt = context.currentTime + 0.08; // a beat of slack to schedule in
  const sources: OscillatorNode[] = [];

  /**
   * One wave per pitch, one oscillator per note.
   *
   * This used to create an oscillator **per harmonic per note**. Four
   * harmonics made that invisible; a violin's twenty-eight would make a
   * hundred-note piece into nearly three thousand nodes, all scheduled up
   * front, on a phone browser.
   *
   * A `PeriodicWave` carries the whole harmonic series in one oscillator, and
   * the series depends only on the fundamental (`harmonicsFor` — the body
   * resonances are fixed in frequency, so two notes an octave apart genuinely
   * need different waves), so it caches by pitch. A piece has a couple of
   * dozen distinct pitches and hundreds of notes.
   *
   * `disableNormalization: true` because the amplitudes are already normalised
   * to sum to one — which bounds the peak at one — and letting Web Audio
   * renormalise would make the register balance differ from the native
   * renderer, where nothing does.
   */
  const waves = new Map<number, PeriodicWave>();
  function waveFor(frequency: number): PeriodicWave {
    const cached = waves.get(frequency);
    if (cached) {
      return cached;
    }
    const harmonics = harmonicsFor(spec, frequency);
    // Index 0 is DC and stays zero; harmonic n sits at index n. Sines, so the
    // amplitudes go in the imaginary part.
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    harmonics.forEach((amplitude, index) => {
      imag[index + 1] = amplitude;
    });
    const wave = context.createPeriodicWave(real, imag, {
      disableNormalization: true,
    });
    waves.set(frequency, wave);
    return wave;
  }

  for (const note of schedule.notes) {
    const at = startedAt + note.startS;
    const until = at + note.durationS;

    // **A note whose times are not numbers is skipped, not scheduled.**
    // `oscillator.start()` and `.stop()` throw on a non-finite time, and the
    // throw escaped this loop — after earlier notes had already been started,
    // with no handle returned to stop them and `onEnd` never called. The
    // button stayed as it was and a note could be left sounding with nothing
    // able to silence it. One `NaN` tempo did that; `scheduleScore` no longer
    // produces one, and this is the second lock on the same door.
    if (!Number.isFinite(at) || !Number.isFinite(until) || until <= at) {
      continue;
    }

    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.setPeriodicWave(waveFor(note.frequency));
    oscillator.frequency.value = note.frequency;

    // Ramps rather than steps: a gain that jumps produces a click, and a
    // click is an onset, which is the one artefact this app must not teach
    // someone to hear as part of the music.
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(1, at + spec.attackS);
    envelope.gain.setValueAtTime(
      1,
      Math.max(until - spec.releaseS, at + spec.attackS),
    );
    envelope.gain.linearRampToValueAtTime(0, until);

    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(at);
    oscillator.stop(until + 0.02);
    sources.push(oscillator);
  }

  let stopped = false;
  let frame = 0;
  let sweep: ReturnType<typeof setTimeout> | undefined;
  let startCheck: ReturnType<typeof setTimeout> | undefined;
  let visibleSince = Date.now();

  function tick() {
    if (stopped) {
      return;
    }
    const elapsed = context.currentTime - startedAt;
    if (elapsed >= schedule.durationS) {
      finish();
      return;
    }
    onProgress?.(Math.max(0, elapsed), schedule.durationS);
    frame = requestAnimationFrame(tick);
  }

  /**
   * The second way playback can end, and the one that matters when nobody is
   * looking.
   *
   * **`requestAnimationFrame` does not run on a hidden page.** Lock the phone,
   * take a call, or switch apps during a Listen and `tick` simply stops being
   * called — so the frame that would have noticed the end never arrives,
   * `finish()` never runs, and the handle reports `isPlaying()` forever. What
   * the musician sees on coming back is a button that still says Stop for a
   * piece that finished minutes ago: the next press stops silence, and only the
   * press after that plays. From the outside that is *"Listen doesn't work when
   * I come back"*.
   *
   * A timer is throttled on a hidden page but it is not stopped, and an overdue
   * one fires on the way back. It **re-checks the audio clock rather than
   * trusting itself**, because the two clocks come apart in exactly this
   * situation: iOS suspends the audio context with the page, freezing
   * `currentTime` while wall time keeps going. Waking up early therefore means
   * waiting again, not cutting a piece off mid-phrase.
   */
  function sweepForEnd() {
    if (stopped) {
      return;
    }
    const remaining = schedule.durationS - (context.currentTime - startedAt);
    if (remaining <= 0) {
      finish();
      return;
    }
    sweep = setTimeout(sweepForEnd, remaining * 1000 + END_SWEEP_SLACK_MS);
  }

  /**
   * The third way playback can end: it never began.
   *
   * Distinguished from the second — a piece paused partway by a locked screen,
   * which `sweepForEnd` correctly waits out — by asking only whether the clock
   * has moved **at all**. A playback that got going and then stopped has
   * already passed `startedAt` and never reaches here; one that never got going
   * has not, and waiting for it forever is the bug.
   *
   * Each look also asks the context to run again. A refused resume is not
   * permanent: the gesture that was missing a moment ago may have arrived, and
   * asking costs nothing when it is already running.
   */
  function watchForStart() {
    if (stopped || context.currentTime > startedAt) {
      return;
    }
    // **A hidden page explains a frozen clock, so it does not count.** iOS
    // suspends the context along with the page; the musician has not been
    // failed, they have walked away. Time spent hidden is given back rather
    // than spent, so coming back to a piece that never started still gets its
    // full two seconds to begin.
    if (typeof document !== 'undefined' && document.hidden) {
      visibleSince = Date.now();
      startCheck = setTimeout(watchForStart, START_POLL_MS);
      return;
    }
    if (Date.now() - visibleSince < START_TIMEOUT_MS) {
      resumeAudio(context);
      startCheck = setTimeout(watchForStart, START_POLL_MS);
      return;
    }
    // Nothing was heard, so ending is honest rather than a cut-off. The caller
    // puts the button back and the next press builds a fresh schedule — which
    // is what the musician was doing by hand, twice, to get sound out of it.
    finish();
  }

  function finish() {
    if (stopped) {
      return;
    }
    stopped = true;
    cancelAnimationFrame(frame);
    clearTimeout(sweep);
    clearTimeout(startCheck);
    sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already finished on its own; nothing to do.
      }
    });
    // **Disconnected, not closed.** The context outlives this playback and
    // every one after it; what has to go is this play's own mixer node, or the
    // graph grows by one gain per Listen for the life of the page.
    try {
      master.disconnect();
    } catch {
      // Already gone.
    }
    onEnd?.();
  }

  frame = requestAnimationFrame(tick);
  sweepForEnd();
  watchForStart();

  return {
    stop: finish,
    isPlaying: () => !stopped,
  };
}
