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

/** Equality for the editor, where null means “no printed change”, not C major. */
export function sameEditableSignature(
  a: string | null,
  b: string | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  const left = accidentalCount(a);
  const right = accidentalCount(b);
  return left !== null && right !== null ? left === right : a === b;
}

/**
 * Apply one deliberate correction at the right schema level.
 *
 * The first measure edits the score header. Every later measure edits only the
 * signature printed at that bar; null removes a false change and lets the
 * preceding signature continue.
 *
 * **Two things this normalises, because the control cannot.** The sheet offers
 * all fifteen signatures and asks a musician which one is *printed at this
 * bar* — but the natural way to read a list of keys is "which key is this bar
 * in", and those are different questions on every bar that prints nothing.
 *
 *  - Choosing the signature **already in force** records no change at all.
 *    Storing it would put a key change on a bar the page does not change at,
 *    and the engraver believes the score: it draws the new signature after the
 *    barline *and* prints a courtesy at the end of the line before it, warning
 *    a reader about a change to the key they are already in.
 *  - Editing the opening key **clears any signature stamped on the first bar**.
 *    A measure-level key outranks the header — that is what makes a change a
 *    change — so setting the header while leaving one there is a silent no-op:
 *    the musician corrects the opening key, the screen closes, and the score
 *    still opens in the old one. `start_from_measure` stamps the entry bar with
 *    the key in force, so a score whose first measure carries one is a shape
 *    this app actually produces.
 */
export function applyKeySignatureEdit(
  score: ScoreJson,
  measureNumber: number,
  value: string | null,
): ScoreJson {
  if (score.measures[0]?.measure_number === measureNumber) {
    return {
      ...score,
      key_signature: value,
      measures: score.measures.map((measure, index) =>
        index === 0 ? { ...measure, key_signature: null } : measure,
      ),
    };
  }
  // Against the key in force, never against the header — the whole point of a
  // change is that it differs from what was already sounding.
  const printed = sameEditableSignature(value, keyBeforeMeasure(score, measureNumber))
    ? null
    : value;
  return {
    ...score,
    measures: score.measures.map((measure) =>
      measure.measure_number === measureNumber
        ? { ...measure, key_signature: printed }
        : measure,
    ),
  };
}
