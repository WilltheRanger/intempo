import type { Schedule } from './score/schedule';
import { DEFAULT_VOICE, VOICES, type VoiceName } from './score/voice';
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
 */
export function playSchedule(
  schedule: Schedule,
  { voice = DEFAULT_VOICE, onProgress, onEnd }: PlayOptions = {},
): PlaybackHandle {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextCtor || schedule.notes.length === 0) {
    onEnd?.();
    return { stop: () => {}, isPlaying: () => false };
  }

  const context = new AudioContextCtor();
  const spec = VOICES[voice as VoiceName] ?? VOICES[DEFAULT_VOICE];

  // Headroom: four harmonics summing at once would clip an unscaled master.
  const master = context.createGain();
  master.gain.value = spec.gain;
  master.connect(context.destination);

  const startedAt = context.currentTime + 0.08; // a beat of slack to schedule in
  const sources: OscillatorNode[] = [];

  for (const note of schedule.notes) {
    const at = startedAt + note.startS;
    const until = at + note.durationS;

    spec.harmonics.forEach((amplitude, index) => {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = note.frequency * (index + 1);

      // Ramps rather than steps: a gain that jumps produces a click, and a
      // click is an onset, which is the one artefact this app must not teach
      // someone to hear as part of the music.
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(amplitude, at + spec.attackS);
      envelope.gain.setValueAtTime(amplitude, Math.max(until - spec.releaseS, at + spec.attackS));
      envelope.gain.linearRampToValueAtTime(0, until);

      oscillator.connect(envelope);
      envelope.connect(master);
      oscillator.start(at);
      oscillator.stop(until + 0.02);
      sources.push(oscillator);
    });
  }

  let stopped = false;
  let frame = 0;

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

  function finish() {
    if (stopped) {
      return;
    }
    stopped = true;
    cancelAnimationFrame(frame);
    sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already finished on its own; nothing to do.
      }
    });
    void context.close();
    onEnd?.();
  }

  // Autoplay policy hands back a suspended context even from a tap on some
  // browsers; without this the notes are scheduled into a clock that isn't
  // running and nothing sounds.
  if (context.state === 'suspended') {
    void context.resume();
  }
  frame = requestAnimationFrame(tick);

  return {
    stop: finish,
    isPlaying: () => !stopped,
  };
}
