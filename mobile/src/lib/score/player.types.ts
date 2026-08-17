import type { VoiceName } from './voice';

export interface PlayOptions {
  /**
   * Which voice to sound. One today; the owner's instrument preference will
   * choose between several, set in the profile or during onboarding.
   */
  voice?: VoiceName;
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
