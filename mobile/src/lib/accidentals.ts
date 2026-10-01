/**
 * Where ♭ ♮ ♯ ♩ 𝄫 𝄪 sit in a piece of text, so `Text` can draw them in the font
 * that has them (`fontFamily.accidentals`).
 *
 * **Neither text face draws them.** Left to the device, "B♭" came out as
 * "B ♭" on an iPhone — a symbol font's spacing and baseline beside Inter
 * (2026-10-01). A rule rather than a regex inside the component because there
 * is no React Native testing library here (`DECISIONS.md`, 2026-08-24).
 */

// `u`, because the double sharp and double flat are outside the BMP: without
// it the class matches half of a surrogate pair and splits the character.
const ACCIDENTAL = /[♩♭♮♯\u{1D12A}\u{1D12B}]/u;
const SPLIT = /([♩♭♮♯\u{1D12A}\u{1D12B}]+)/u;

export interface TextSegment {
  text: string;
  accidental: boolean;
}

/** Whether a string has anything that needs the accidentals font. */
export function hasAccidental(text: string): boolean {
  return ACCIDENTAL.test(text);
}

/**
 * The string cut into runs of ordinary text and runs of accidentals, in
 * order, with nothing lost and no empty runs. "Your low B♭s" is
 * `Your low B` · `♭` · `s`.
 */
export function splitAccidentals(text: string): TextSegment[] {
  return text
    .split(SPLIT)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, accidental: ACCIDENTAL.test(part) }));
}
