import { AudioModule } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import { prepareForPlayback } from '../audio/session';
import { encodeWavBytes } from '../audio/wav';
import { ACCENT_HZ, CLICK_GAIN, CLICK_HZ, CLICK_S } from './clickSound';
import { startBeatClock, startPlannedBeatClock } from './clock';
import type { ClickTrack, ClickTrackOptions } from './click.types';

/**
 * Audible clicks on a device.
 *
 * No Web Audio here, so there is no clock to schedule against — `expo-audio`
 * plays files, and the only way to place a click in time is to trigger it in
 * time. Two short WAVs are rendered once into the cache, held open as players,
 * and re-struck by the beat clock.
 *
 * **This inherits the JS thread's jitter, and the web build does not.** A
 * blocked frame lands a click a few milliseconds late; the browser's version
 * books its clicks on the audio clock and can't. Two players rather than one
 * kept seeking so a downbeat and the beat before it never contend, which is
 * the one part of that gap this can fix without a native module.
 *
 * **Unverified.** There is no simulator or device in the environment this was
 * written in. It typechecks against the documented APIs and has never made a
 * sound. What needs judging on hardware is whether the jitter is audible —
 * if it is, this wants a native scheduler rather than a faster timer.
 */

const SAMPLE_RATE = 22050;

/** One click as 16-bit PCM: a decaying burst, no attack ramp. */
function renderClick(frequency: number): Int16Array {
  const length = Math.floor(CLICK_S * SAMPLE_RATE);
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    // Exponential decay from full. The ear times the edge, so the edge is
    // where the energy goes; softening it would soften the beat itself.
    const envelope = Math.exp(-t / (CLICK_S / 4));
    const sample = Math.sign(Math.sin(2 * Math.PI * frequency * t)) * envelope * CLICK_GAIN;
    const clamped = Math.max(-1, Math.min(1, sample));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm;
}

function writeClick(name: string, frequency: number): File {
  const bytes = encodeWavBytes({
    chunks: [renderClick(frequency)],
    sampleRate: SAMPLE_RATE,
    channels: 1,
  });
  const target = new File(Paths.cache, name);
  target.create({ overwrite: true });
  target.write(bytes);
  return target;
}

export function startClicks({ bpm, perBar, beats }: ClickTrackOptions): ClickTrack {
  let stopped = false;
  let clock: { stop: () => void } | null = null;
  let files: File[] = [];
  let players: { play: () => void; seekTo: (s: number) => Promise<void>; remove: () => void }[] =
    [];

  function cleanUp() {
    clock?.stop();
    clock = null;
    for (const player of players) {
      try {
        player.remove();
      } catch {
        // Already released.
      }
    }
    players = [];
    for (const file of files) {
      try {
        file.delete();
      } catch {
        // The cache is the system's to clear; a failure here costs nothing.
      }
    }
    files = [];
  }

  // The session, before the players. A metronome that the ring switch can
  // silence is a metronome that is off exactly when a practice room is quiet.
  // Not awaited: this returns a `ClickTrack` synchronously and the first beat
  // is a whole beat away, which is far longer than setting a category takes.
  void prepareForPlayback();

  try {
    const plainFile = writeClick('intempo-click.wav', CLICK_HZ);
    const accentFile = writeClick('intempo-click-accent.wav', ACCENT_HZ);
    files = [plainFile, accentFile];

    const plain = new AudioModule.AudioPlayer({ uri: plainFile.uri }, 100, false, 0);
    const accent = new AudioModule.AudioPlayer({ uri: accentFile.uri }, 100, false, 0);
    players = [plain, accent] as unknown as typeof players;

    const strike = (beat: { downbeat: boolean }) => {
      if (stopped) {
        return;
      }
      const player = beat.downbeat ? accent : plain;
      // Rewind before striking: a player left at the end of its file plays
      // nothing, and at these lengths the previous click has long finished.
      void player.seekTo(0).then(() => {
        if (!stopped) {
          player.play();
        }
      });
    };
    clock = beats
      ? startPlannedBeatClock({ beats, onBeat: strike })
      : startBeatClock({ bpm, perBar, onBeat: strike });
  } catch {
    // A render or write failure must not take a take down with it. The
    // metronome is an aid; the recording is the point.
    cleanUp();
    return { stop: () => {}, leadInS: 0 };
  }

  return {
    // No slack: this strikes a player from the same kind of timer the on-screen
    // pulse uses, so the two are already counting from the same instant.
    leadInS: 0,
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      cleanUp();
    },
  };
}
