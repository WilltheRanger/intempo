import { audioContext, resumeAudio } from './audio/context.web';
import { prepareForPlayback } from './audio/session.web';
import type { Schedule } from './score/schedule';
import { DEFAULT_VOICE, harmonicsFor, VOICES, type VoiceName } from './score/voice';
import type { PlaybackHandle, PlayOptions } from './score/player.types';

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

/** Schedule and play a score, returning a handle that can stop it. */
export function playSchedule(
  schedule: Schedule,
  { voice = DEFAULT_VOICE, onProgress, onEnd }: PlayOptions = {},
): PlaybackHandle {
  // Asked in this order on purpose: a score with nothing in it must not be the
  // thing that spends the page's one audio context. Building it is otherwise
  // free, but on iOS a context is a capped resource and this branch is reached
  // by every screen that renders a Listen for a piece still being read.
  if (schedule.notes.length === 0) {
    onEnd?.();
    return { stop: () => {}, isPlaying: () => false };
  }

  const maybeContext = audioContext();
  if (!maybeContext) {
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
    const wave = context.createPeriodicWave(real, imag, { disableNormalization: true });
    waves.set(frequency, wave);
    return wave;
  }

  for (const note of schedule.notes) {
    const at = startedAt + note.startS;
    const until = at + note.durationS;

    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.setPeriodicWave(waveFor(note.frequency));
    oscillator.frequency.value = note.frequency;

    // Ramps rather than steps: a gain that jumps produces a click, and a
    // click is an onset, which is the one artefact this app must not teach
    // someone to hear as part of the music.
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(1, at + spec.attackS);
    envelope.gain.setValueAtTime(1, Math.max(until - spec.releaseS, at + spec.attackS));
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

  function finish() {
    if (stopped) {
      return;
    }
    stopped = true;
    cancelAnimationFrame(frame);
    clearTimeout(sweep);
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

  return {
    stop: finish,
    isPlaying: () => !stopped,
  };
}
