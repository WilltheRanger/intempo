import type { ScoreJson } from '../../data/types';

/**
 * The time signature in force at each printed measure.
 *
 * A measure only stores a signature when the page changes it; every following
 * measure inherits that value until another change is printed. Computing this
 * from written order is important for repeats: jumping back to an earlier bar
 * also jumps back to the meter that was in force there.
 */
export function timeSignaturesByMeasure(
  score: ScoreJson,
): ReadonlyMap<number, string | null> {
  const meters = new Map<number, string | null>();
  let standing = score.time_signature ?? null;

  for (const measure of score.measures ?? []) {
    if (measure.time_signature != null) {
      standing = measure.time_signature;
    }
    meters.set(measure.measure_number, standing);
  }

  return meters;
}

/** The meter a take or playback starts in, including a change on its first bar. */
export function openingTimeSignature(
  score: ScoreJson | null | undefined,
): string | null {
  if (!score) {
    return null;
  }
  const first = score.measures?.[0];
  return first?.time_signature ?? score.time_signature ?? null;
}
