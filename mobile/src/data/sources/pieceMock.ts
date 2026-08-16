/**
 * Placeholder score facts for screens that need them before transcription is
 * real.
 *
 * Nothing derives these from a piece — there is no score JSON yet. They live
 * here rather than as constants inside each screen so the two that use them
 * can't drift, and so there is one obvious place to delete from when the real
 * data arrives.
 */

/** Measures in the piece. Real counts come from the parsed score. */
export const MOCK_MEASURE_COUNT = 24;

/** Starting tempo. Real pieces carry a target BPM set by the musician. */
export const MOCK_DEFAULT_BPM = 72;

/** Bounds and step for the tempo control. */
export const TEMPO_MIN = 40;
export const TEMPO_MAX = 208;
export const TEMPO_STEP = 2;
