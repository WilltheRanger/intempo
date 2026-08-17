/**
 * What a played-back note sounds like.
 *
 * One voice today, and a seam for more. The owner asked for an instrument
 * choice set in the profile or during onboarding, deferred for now — so this
 * is a record keyed by name rather than a hard-coded oscillator, and adding
 * cello or double bass later means adding an entry, not restructuring a
 * player.
 *
 * A reference tone, not an impersonation. Sampled instruments are the honest
 * way to sound like a cello and they are megabytes per instrument; a
 * synthesised approximation that *almost* sounds like a cello is worse than a
 * clean tone that obviously isn't one, because the near-miss invites the
 * comparison. This is here so a musician can hear the notes and the tempo.
 */

export interface Voice {
  /** Relative amplitudes of the harmonic series, starting at the fundamental. */
  harmonics: number[];
  /** Seconds to reach full amplitude. Bowed strings don't start instantly. */
  attackS: number;
  /** Seconds to fall silent after the note's written end. */
  releaseS: number;
  /** Overall level, before any mixing headroom. */
  gain: number;
}

export type VoiceName = 'reference';

export const VOICES: Record<VoiceName, Voice> = {
  /**
   * A plain tone with a little of the second and third harmonic — enough body
   * that it doesn't read as a test signal, far enough from any real instrument
   * that it isn't pretending.
   */
  reference: {
    harmonics: [1, 0.32, 0.14, 0.05],
    // 12ms: audibly a bow rather than a click, without smearing the beat a
    // musician is listening for.
    attackS: 0.012,
    releaseS: 0.09,
    gain: 0.22,
  },
};

export const DEFAULT_VOICE: VoiceName = 'reference';
