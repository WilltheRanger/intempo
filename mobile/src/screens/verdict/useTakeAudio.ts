import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback } from 'react';

import { prepareForPlayback } from '../../lib/audio/session';

/**
 * A recording, as `ScrubPlayer` drives it: where it is, how long it is, and
 * the three things a musician does to it.
 *
 * **Two engines behind one shape**, because one engine cannot open both kinds
 * of recording on the web. `expo-audio` plays the verdict's signed https link
 * and refuses a take the app is still holding — given a `blob:` URL it creates
 * no player and never fetches it (measured in Chromium, `heldTake.web.ts`). The
 * web half (`useTakeAudio.web.ts`) is the browser's own `<audio>`, which opens
 * both; this half is the native one, where a held take has no URL at all and
 * the review step draws no player (`heldTake.ts`).
 */
export interface TakeAudio {
  /** Loaded far enough to play and seek. */
  ready: boolean;
  playing: boolean;
  /** The recording could not be opened. */
  failed: boolean;
  /** Seconds in. */
  current: number;
  /** Seconds long; 0 until it is known. */
  duration: number;
  /**
   * Play from where it is, or from the top once it has finished.
   *
   * **`stillWanted` is asked after every wait.** Asking for the audio session
   * takes a moment, and a musician who leaves the screen inside it must not
   * come back to a recording that started on its own.
   */
  play: (stillWanted: () => boolean) => Promise<void>;
  /** Safe on a player already released. Stable across renders. */
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
}

export function useTakeAudio(uri: string): TakeAudio {
  const player = useAudioPlayer({ uri }, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  const duration = Math.max(0, status.duration || 0);
  const current = Math.min(duration || Infinity, Math.max(0, status.currentTime || 0));
  const finished = duration > 0 && current >= Math.max(0, duration - 0.05) && !status.playing;

  const pause = useCallback(() => {
    try {
      player.pause();
    } catch {
      // Released underneath us by leaving the screen.
    }
  }, [player]);

  const seekTo = useCallback(
    async (seconds: number) => {
      try {
        await player.seekTo(seconds);
      } catch {
        // Released underneath us by leaving the screen.
      }
    },
    [player],
  );

  async function play(stillWanted: () => boolean) {
    await prepareForPlayback();
    if (!stillWanted()) return;
    if (finished) await player.seekTo(0);
    if (!stillWanted()) return;
    player.play();
  }

  return {
    ready: status.isLoaded && !(status.isBuffering && !status.playing),
    playing: status.playing,
    failed: Boolean(status.error),
    current,
    duration,
    play,
    pause,
    seekTo,
  };
}
