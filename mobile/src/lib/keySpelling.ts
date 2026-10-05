/**
 * One spelling for every way of writing an accidental, shared by Library
 * search (`library.ts`) and title autofill (`autofill.ts`).
 *
 * The app prints "B♭", the built-in repertoire writes "B-flat", a copied
 * catalogue entry may say "B flat", and a phone keyboard types "Bb". All four
 * are one key, and both places that match what a musician types against a
 * title need to know it — in one rule, so they cannot disagree about what a
 * key is.
 */

/** Folded the way a phone keyboard types it: no case, no accents. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const SIGNS: Record<string, string> = { '♭': 'b', '♯': '#', '♮': '' };
/** "-flat" or " sharp" straight after a note name, as a whole word. */
const SPELLED_OUT = /^[\s-]+(flat|sharp)(?![a-z])/i;

/**
 * `text` folded, with every accidental written one way — "B♭", "Bb",
 * "B flat" and "B-flat" all "bb" — and, for each character of that, where it
 * ends in `text`, so a match can be measured back in the original.
 *
 * Only a note name standing alone takes a following "flat": the b of "Club"
 * is not a key.
 */
export function spellKeys(text: string): { text: string; ends: number[] } {
  let out = '';
  const ends: number[] = [];
  const emit = (chars: string, end: number) => {
    out += chars;
    for (let k = 0; k < chars.length; k++) ends.push(end);
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char in SIGNS) {
      emit(SIGNS[char], i + 1);
      i += 1;
      continue;
    }
    const alone = /[a-g]/i.test(char) && !/\p{L}/u.test(text[i - 1] ?? '');
    const spelled = alone ? SPELLED_OUT.exec(text.slice(i + 1)) : null;
    if (spelled) {
      emit(fold(char), i + 1);
      i += 1 + spelled[0].length;
      emit(spelled[1].toLowerCase() === 'flat' ? 'b' : '#', i);
      continue;
    }
    emit(fold(char), i + 1);
    i += 1;
  }
  return { text: out, ends };
}
