import type { VoiceName } from './voice';

export interface PlayOptions {
  /**
   * Settings instruments use recordings. The explicit reference voice is
   * retained for internal callers, never as a failed-download fallback.
   */
  voice?: VoiceName;
  /** Loading is cancellable and counts as active playback for the handle. */
  onLoading?: (loading: boolean) => void;
  /** A failed sample load never silently substitutes a synthesized voice. */
  onError?: (message: string) => void;
  /** Seconds elapsed and total, for a playhead. Called about once a frame. */
  onProgress?: (elapsedS: number, totalS: number) => void;
  /** Fired once, whether playback finished or was stopped. */
  onEnd?: () => void;
}

export interface PlaybackHandle {
  /** Idempotent. Safe to call after playback has already finished. */
  stop: () => void;
  isPlaying: () => boolean;
}
