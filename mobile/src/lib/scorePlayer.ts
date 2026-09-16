import { AudioModule } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import { prepareForPlayback } from './audio/session';
import { listenFailure, startTimeout } from './score/listenFailure';
import { encodeWavBytes } from './audio/wav';
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
 * Playing a score on a device.
 *
 * Web Audio doesn't exist here and `expo-audio` plays files rather than
 * synthesising, so the piece is rendered to PCM in JavaScript, written to a
 * WAV in the cache directory, and handed to a player.
 *
 * Rendering the whole thing up front rather than streaming is deliberate: the
 * timing then lives in the samples, where nothing can perturb it. A note
 * triggered by a JS timer inherits every hitch of the JS thread, and this app
 * is in the business of telling people their timing is off — a reference that
 * wanders would be worse than no reference.
 *
 * 22.05 kHz mono, which is what the analysis pipeline loads at anyway. A
 * three-minute piece is about 8 MB of Int16 held briefly while it's written.
 *
 * **Unverified.** There is no simulator or device in the environment this was
 * written in. It is built against `expo-audio`'s and `expo-file-system`'s
 * documented APIs and typechecks, and it has never made a sound.
 */

const SAMPLE_RATE = 22050;
const CHANNELS = 1;

/** Mix the schedule down to 16-bit PCM. */
function render(schedule: Schedule, voice: VoiceName): Int16Array {
  const spec = VOICES[voice] ?? VOICES[DEFAULT_VOICE];
  const total = Math.ceil(
    (schedule.durationS + spec.releaseS + 0.2) * SAMPLE_RATE,
  );
  const mix = new Float32Array(Math.max(total, 1));

  for (const note of schedule.notes) {
    const start = Math.floor(note.startS * SAMPLE_RATE);
    const length = Math.floor((note.durationS + spec.releaseS) * SAMPLE_RATE);
    const attack = Math.max(1, Math.floor(spec.attackS * SAMPLE_RATE));
    const release = Math.max(1, Math.floor(spec.releaseS * SAMPLE_RATE));
    const sustainEnd = Math.max(attack, length - release);
    // **Computed per note, not per voice.** An instrument's body resonances sit
    // at fixed frequencies, so which harmonic they lift depends on the note —
    // see `harmonicsFor`. A single amplitude list would be a waveform being
    // transposed, which is what a synthesiser sounds like.
    const harmonics = harmonicsFor(spec, note.frequency);

    for (let i = 0; i < length; i += 1) {
      const at = start + i;
      if (at >= mix.length) {
        break;
      }
      // Linear attack and release. Ramps rather than steps: a gain that jumps
      // is a click, and a click is an onset — the one artefact this app must
      // not teach someone to hear as part of the music.
      const envelope =
        i < attack
          ? i / attack
          : i > sustainEnd
            ? Math.max(0, 1 - (i - sustainEnd) / release)
            : 1;

      const t = i / SAMPLE_RATE;
      let sample = 0;
      for (let h = 0; h < harmonics.length; h += 1) {
        sample +=
          harmonics[h] * Math.sin(2 * Math.PI * note.frequency * (h + 1) * t);
      }
      mix[at] += sample * envelope * spec.gain;
    }
  }

  const pcm = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, mix[i]));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm;
}

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
  if (schedule.notes.length === 0) {
    onEnd?.();
    return { stop: () => {}, isPlaying: () => false };
  }

  if (voice !== 'reference') {
    return beginSampledPlayback(
      schedule,
      voice,
      { onProgress, onEnd, onLoading, onError },
      async (audio, cancelled, finish) => {
        await prepareForPlayback();
        if (cancelled()) return () => {};
        const target = new File(
          Paths.cache,
          `intempo-sampled-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
        );
        let created: InstanceType<typeof AudioModule.AudioPlayer> | undefined;
        let timer: ReturnType<typeof setInterval> | undefined;
        const cleanup = () => {
          clearInterval(timer);
          try {
            created?.remove();
          } catch {
            /* Already released. */
          }
          try {
            target.delete();
          } catch {
            /* File was not created. */
          }
        };
        try {
          target.create({ overwrite: true });
          target.write(
            encodeWavBytes({
              chunks: [audio.pcm],
              sampleRate: audio.sampleRate,
              channels: audio.channels,
            }),
          );
          created = new AudioModule.AudioPlayer(
            { uri: target.uri },
            100,
            false,
            0,
          );
          created.play();
          const started = Date.now();
          timer = setInterval(() => {
            const elapsed = created?.currentTime ?? 0;
            if (
              elapsed >= audio.durationS ||
              created?.currentStatus.didJustFinish
            ) {
              finish();
              return;
            }
            if (elapsed === 0 && Date.now() - started > 10000) {
              // The native player has no `AudioContext`, so what it can name
              // is whether the file it was handed ever loaded — the same
              // question, asked of the only clock this path has.
              onError?.(
                listenFailure(
                  'starting',
                  startTimeout(
                    created?.isLoaded ? 'player loaded' : 'player not loaded',
                    Date.now() - started,
                  ),
                ),
              );
              finish();
              return;
            }
            onProgress?.(
              Math.min(elapsed, schedule.durationS),
              schedule.durationS,
            );
          }, 100);
        } catch (error) {
          cleanup();
          throw error;
        }
        return cleanup;
      },
    );
  }

  let stopped = false;
  let player: {
    play: () => void;
    remove: () => void;
    currentTime: number;
  } | null = null;
  let file: File | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function cleanUp() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    try {
      player?.remove();
    } catch {
      // Already released.
    }
    player = null;
    try {
      // The cache directory is the system's to clear, but a rendered piece has
      // no value after it has been heard and can be megabytes.
      file?.delete();
    } catch {
      // Nothing to clean up.
    }
    file = null;
  }

  function finish() {
    if (stopped) {
      return;
    }
    stopped = true;
    cleanUp();
    onEnd?.();
  }

  // Rendering is synchronous and can take a moment on a long piece, so it
  // happens off the call that started playback.
  void (async () => {
    try {
      // **Before anything is rendered, not after.** A take leaves iOS in the
      // recording session (`audioRecorder.ts` deliberately lets `AudioStream`
      // own it), and an unconfigured session obeys the ring/silent switch —
      // which is how Listen came to play nothing at all on a phone on silent.
      await prepareForPlayback();
      const pcm = render(schedule, voice);
      const bytes = encodeWavBytes({
        chunks: [pcm],
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
      });

      if (stopped) {
        return;
      }

      const target = new File(Paths.cache, `intempo-listen-${Date.now()}.wav`);
      target.create({ overwrite: true });
      // `write` takes a string or a typed array; the bytes go straight down.
      target.write(bytes);
      file = target;

      const created = new AudioModule.AudioPlayer(
        { uri: target.uri },
        100,
        false,
        0,
      );
      player = created as unknown as typeof player;
      created.play();

      timer = setInterval(() => {
        if (stopped || !player) {
          return;
        }
        const elapsed = player.currentTime;
        if (elapsed >= schedule.durationS) {
          finish();
          return;
        }
        onProgress?.(elapsed, schedule.durationS);
      }, 100);
    } catch {
      // A render or write failure is not worth a crash on a listen button.
      finish();
    }
  })();

  return {
    stop: finish,
    isPlaying: () => !stopped,
  };
}
