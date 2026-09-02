import type { Clef } from '../../data/types';

/**
 * The sharps or flats printed at the start of every system.
 *
 * **The app has never drawn one.** `ScoreJson.key_signature` has been read off
 * the page since Batch 2, shown as text in the metadata line, and then
 * discarded — so a piece in E major was engraved with four accidentals missing
 * from every system and an inline sharp on each note that happened to need
 * one. That is not a page of music; it is a list of pitches, and it is the
 * single clearest reason the stave read as a diagram rather than as sheet
 * music.
 *
 * Two things are needed and both are conventions with no room for invention:
 * how many accidentals a key has, and where each one goes on which clef.
 */

/**
 * Sharps and flats per key. Positive is sharps.
 *
 * Both modes, because `key_signature` is read off the page as printed and
 * "A minor" and "C major" carry the same signature but are not the same
 * string. Minor keys are the relative minor of the major three semitones
 * above, which is why each row is the major row shifted by three.
 */
const MAJOR: Record<string, number> = {
  c: 0, g: 1, d: 2, a: 3, e: 4, b: 5, 'f#': 6, 'c#': 7,
  f: -1, bb: -2, eb: -3, ab: -4, db: -5, gb: -6, cb: -7,
};

const MINOR: Record<string, number> = {
  a: 0, e: 1, b: 2, 'f#': 3, 'c#': 4, 'g#': 5, 'd#': 6, 'a#': 7,
  d: -1, g: -2, c: -3, f: -4, bb: -5, eb: -6, ab: -7,
};

/**
 * How many sharps (positive) or flats (negative) a key name carries, or null.
 *
 * Null for "unknown", for absent, and for anything unrecognised — and that is
 * a real answer rather than a failure. A page whose header was cut off or
 * illegible has no signature to print, and printing C major's *nothing* is
 * accidentally correct while printing a guess is not.
 *
 * Tolerant about the mode word because it is read off a photograph: "D major",
 * "D Major", "d maj", and a bare "D" all arrive. A bare letter is read as
 * major, which is the convention when a key is named without a mode.
 */
export function accidentalCount(keySignature: string | null | undefined): number | null {
  if (!keySignature) {
    return null;
  }
  const text = keySignature.trim().toLowerCase();
  if (!text || text === 'unknown') {
    return null;
  }
  const match = /^([a-g](?:#|b|♯|♭)?)\s*(.*)$/.exec(text);
  if (!match) {
    return null;
  }
  const tonic = match[1].replace('♯', '#').replace('♭', 'b');
  const mode = match[2];
  const minor = mode.startsWith('min') || mode === 'm';
  const table = minor ? MINOR : MAJOR;
  const count = table[tonic];
  return count === undefined ? null : count;
}

/**
 * Where each accidental goes, as a pitch, for each clef.
 *
 * **Order and octave are both fixed by convention**, and neither is derivable
 * from anything else here. Sharps run F C G D A E B and flats run the same
 * sequence backwards; the octave of each is chosen so the signature sits
 * inside or just around the staff and reads as a shape rather than a scatter.
 *
 * Tenor clef is the one that catches people out: its staff sits a third below
 * alto's, so alto's positions transplanted there would put the first sharp
 * above the top line. Both of its rows were wrong here first time round —
 * copied from bass — and the test that caught it is the one below asserting
 * that nothing strays more than a step off the staff.
 */
const SHARPS: Record<Clef, string[]> = {
  treble: ['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4'],
  bass: ['F3', 'C3', 'G3', 'D3', 'A2', 'E3', 'B2'],
  alto: ['F4', 'C4', 'G4', 'D4', 'A3', 'E4', 'B3'],
  // Tenor sits a third below alto, so alto's `F4` would land above the top
  // line. Every one of these is on the staff.
  tenor: ['F3', 'C4', 'G3', 'D4', 'A3', 'E4', 'B3'],
};

const FLATS: Record<Clef, string[]> = {
  treble: ['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4'],
  bass: ['B2', 'E3', 'A2', 'D3', 'G2', 'C3', 'F2'],
  alto: ['B3', 'E4', 'A3', 'D4', 'G3', 'C4', 'F3'],
  // The same staff positions as alto, which is a different set of pitches:
  // both clefs put the first flat in the space just off the middle line.
  tenor: ['B3', 'E4', 'A3', 'D4', 'G3', 'C4', 'F3'],
};

export interface KeyAccidental {
  /** Scientific pitch naming the staff position, e.g. `F5`. */
  pitch: string;
  kind: 'sharp' | 'flat';
}

/**
 * The accidentals to print, in printing order.
 *
 * Empty for C major, for A minor, and for a key nothing could read — three
 * different situations that print the same thing, which is why the caller
 * asks this and not `accidentalCount`.
 */
export function keySignatureFor(
  keySignature: string | null | undefined,
  clef: Clef,
): KeyAccidental[] {
  const count = accidentalCount(keySignature);
  if (count === null || count === 0) {
    return [];
  }
  const kind = count > 0 ? 'sharp' : 'flat';
  const order = count > 0 ? SHARPS[clef] : FLATS[clef];
  return order.slice(0, Math.abs(count)).map((pitch) => ({ pitch, kind }));
}

/** The two numbers of a `N/N` time signature, or null. */
export function timeSignatureDigits(
  timeSignature: string | null | undefined,
): { beats: number; unit: number } | null {
  if (!timeSignature) {
    return null;
  }
  // The same spacing tolerance `beatsPerMeasure` learned the hard way: a metre
  // OCR read as " 4 / 4 " is a metre.
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(timeSignature.trim());
  if (!match) {
    return null;
  }
  const beats = Number(match[1]);
  const unit = Number(match[2]);
  if (!beats || !unit) {
    return null;
  }
  return { beats, unit };
}

/** One glyph of a key change: the new signature's marks, or a natural cancelling an old one. */
export interface KeyChangeGlyph {
  pitch: string;
  kind: 'sharp' | 'flat' | 'natural';
}

/**
 * What is printed at the barline where the key changes from one signature to
 * the next.
 *
 * **Usually just the new signature.** Modern engraving (Gould, *Behind Bars*)
 * does not cancel the old accidentals when the new key has some of its own —
 * a reader sees one sharp where there were two flats and understands it.
 *
 * **Except when the new key has none.** A change to C major or A minor prints
 * *nothing* under that rule, and a change that prints nothing is invisible:
 * the two flats would silently stop applying and every B and E after the
 * barline would be read a semitone off. So that case, and only that case,
 * prints a natural on each accidental of the old signature, in the old
 * signature's order — which is also the traditional cancellation and the one
 * every reader recognises.
 *
 * Positions come from the caller's clef, the same as the head's: a change
 * printed mid-line sits on the same lines the head would put it on.
 */
export function keyChangeGlyphs(
  previous: KeyAccidental[],
  next: KeyAccidental[],
): KeyChangeGlyph[] {
  if (next.length > 0) {
    return next.map((accidental) => ({ ...accidental }));
  }
  return previous.map((accidental) => ({ pitch: accidental.pitch, kind: 'natural' }));
}

/**
 * Whether two key names print the same signature.
 *
 * `Bb major` and `G minor` are the same two flats, so a measure that names
 * the relative key is not a change on the page. Two names nothing can read
 * are alike too — there is nothing to redraw between them.
 */
export function sameSignature(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (accidentalCount(a) ?? 0) === (accidentalCount(b) ?? 0);
}
