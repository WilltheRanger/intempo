import type { ScoreJson } from '../../data/types';
import { accidentalCount } from '../../lib/notation/keySignature';

export interface KeySignatureChoice {
  /** Canonical spelling stored in the score. Relative minor prints the same marks. */
  value: string;
  label: string;
}

const NAMES: Record<number, { major: string; minor: string }> = {
  [-7]: { major: 'C♭', minor: 'A♭' },
  [-6]: { major: 'G♭', minor: 'E♭' },
  [-5]: { major: 'D♭', minor: 'B♭' },
  [-4]: { major: 'A♭', minor: 'F' },
  [-3]: { major: 'E♭', minor: 'C' },
  [-2]: { major: 'B♭', minor: 'G' },
  [-1]: { major: 'F', minor: 'D' },
  0: { major: 'C', minor: 'A' },
  1: { major: 'G', minor: 'E' },
  2: { major: 'D', minor: 'B' },
  3: { major: 'A', minor: 'F♯' },
  4: { major: 'E', minor: 'C♯' },
  5: { major: 'B', minor: 'G♯' },
  6: { major: 'F♯', minor: 'D♯' },
  7: { major: 'C♯', minor: 'A♯' },
};

function storedName(name: string): string {
  return name.replace('♭', 'b').replace('♯', '#') + ' major';
}

function marks(count: number): string {
  if (count === 0) {
    return 'No sharps or flats';
  }
  const amount = Math.abs(count);
  const kind = count > 0 ? 'sharp' : 'flat';
  return `${amount} ${kind}${amount === 1 ? '' : 's'}`;
}

/**
 * The fifteen signatures a single staff can print.
 *
 * Major and relative minor share a row because the control corrects the marks
 * on the page, not a harmonic analysis the photograph may never state.
 */
export const KEY_SIGNATURE_CHOICES: KeySignatureChoice[] = Object.keys(NAMES)
  .map(Number)
  .sort((a, b) => a - b)
  .map((count) => {
    const names = NAMES[count];
    return {
      value: storedName(names.major),
      label: `${marks(count)} · ${names.major} major / ${names.minor} minor`,
    };
  });

/** A saved spelling, rendered as the signature it prints. */
export function describeKeySignature(value: string | null | undefined): string {
  const count = accidentalCount(value);
  if (count === null) {
    return value?.trim() || 'Unknown key signature';
  }
  return KEY_SIGNATURE_CHOICES.find(
    (choice) => accidentalCount(choice.value) === count,
  )?.label ?? value ?? 'Unknown key signature';
}

/** The key holding immediately before one bar begins. */
export function keyBeforeMeasure(
  score: ScoreJson,
  measureNumber: number,
): string | null {
  let key = score.key_signature ?? null;
  for (const measure of score.measures) {
    if (measure.measure_number >= measureNumber) {
      break;
    }
    if (measure.key_signature) {
      key = measure.key_signature;
    }
  }
  return key;
}
