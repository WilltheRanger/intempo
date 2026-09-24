/**
 * What one click sounds like, on every platform.
 *
 * Here rather than in each implementation because both used to define all
 * four numbers, identically, in their own file — so the click's level could
 * only be changed by remembering there were two of it.
 *
 * A click, not a tone: short and hard on purpose. The ear places a transient
 * far more precisely than it places the start of anything that fades in, and
 * placing the beat is the entire job. Two pitches so the downbeat is
 * distinguishable without being louder.
 */
export const CLICK_HZ = 1000;
export const ACCENT_HZ = 1600;
export const CLICK_S = 0.03;

/**
 * The click's peak, −1 dBFS: as loud as it can be without clipping.
 *
 * 0.25 (−12 dBFS) until 2026-09-24, when it was set beside Listen, whose
 * melodies then peaked at −27 to −31 dBFS. Listen was raised 25 dB that day,
 * and the owner asked for the click to follow. It cannot follow all the way:
 * a click already at −12 dBFS has 12 dB of room, and this takes 11 of it, to
 * the ceiling Listen's limiter holds.
 *
 * **What it costs.** The count-in's clicks are discarded with the pre-roll, so
 * their level never reaches the analysis. During a take the click sounds only
 * in the headphones mode, and there a louder click leaks further out of open
 * headphones into the microphone — the reason the downbeat is marked by pitch
 * rather than by level.
 */
export const CLICK_GAIN = 10 ** (-1 / 20);
