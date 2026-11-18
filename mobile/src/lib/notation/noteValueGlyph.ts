import type { NoteValue } from './durationPicker';

/**
 * A single note value drawn as a symbol, the way a metronome mark prints one:
 * a notehead, its stem, its flag and its dot, from the same Bravura glyphs the
 * score is engraved in and at the same proportions `engrave.ts` gives them.
 *
 * **Composed, not a precomposed glyph.** SMuFL has whole "metronome note"
 * symbols, but the app's Bravura is a 22 KB subset whose provenance is
 * recorded in `tools/subset-bravura.py` (1.482 with a graft from 1.392), and
 * adding glyphs means regenerating it from a 1.482 that this environment cannot
 * reach. Everything a note value needs is already in the subset: the three
 * noteheads, the up-flags and the augmentation dot.
 *
 * All measurements are in staff spaces and scaled by `lineGap` at the end.
 */

/** Notehead glyphs and half their width, as `Stave` draws them. */
const HEAD: Record<NoteValue, { glyph: string; halfWidth: number }> = {
  whole: { glyph: '\uE0A2', halfWidth: 0.844 },
  half: { glyph: '\uE0A3', halfWidth: 0.59 },
  quarter: { glyph: '\uE0A4', halfWidth: 0.59 },
  eighth: { glyph: '\uE0A4', halfWidth: 0.59 },
  sixteenth: { glyph: '\uE0A4', halfWidth: 0.59 },
};

/** `flag8thUp`, `flag16thUp`: drawn from the stem's tip, hanging down. */
const FLAG: Partial<Record<NoteValue, string>> = {
  eighth: '\uE240',
  sixteenth: '\uE242',
};

const AUGMENTATION_DOT = '\uE1E7';

/** Where `engrave.ts` puts an up-stem: just right of the head's centre line. */
const STEM_X = 0.62;
/** `engrave.ts`'s `STEM_FACTOR`. */
const STEM_LENGTH = 3.5;
/** Bravura's flags are about this wide. */
const FLAG_WIDTH = 1.16;
/** `Stave`'s `DOT_GAP`, and the dot's own width. */
const DOT_GAP = 0.3;
const DOT_WIDTH = 0.4;
/** Room round the symbol, so a flag or dot is never clipped. */
const PAD = 0.3;
/** Bravura's stem thickness. */
const STEM_THICKNESS = 0.12;

export interface NoteValueDrawing {
  width: number;
  height: number;
  /** The font size that makes one em four staff spaces (SMuFL). */
  fontSize: number;
  head: { glyph: string; x: number; y: number };
  stem: { x: number; from: number; to: number; width: number } | null;
  flag: { glyph: string; x: number; y: number } | null;
  dot: { glyph: string; x: number; y: number } | null;
}

/**
 * Lay a note value out. Every value shares one height and one notehead
 * position, so a row of them sits on a common line, as they would in a
 * palette.
 */
export function drawNoteValue(value: NoteValue, dotted: boolean, lineGap: number): NoteValueDrawing {
  const { glyph, halfWidth } = HEAD[value];
  const centreX = PAD + halfWidth;
  const centreY = PAD + STEM_LENGTH;
  const stemmed = value !== 'whole';
  const flag = FLAG[value] ?? null;

  let right = centreX + halfWidth;
  if (stemmed) right = Math.max(right, centreX + STEM_X + STEM_THICKNESS);
  if (flag) right = Math.max(right, centreX + STEM_X + FLAG_WIDTH);
  if (dotted) right = Math.max(right, centreX + halfWidth + DOT_GAP + DOT_WIDTH);

  const space = (n: number) => n * lineGap;
  return {
    width: space(right + PAD),
    height: space(centreY + 0.5 + PAD),
    fontSize: space(4),
    head: { glyph, x: space(centreX - halfWidth), y: space(centreY) },
    stem: stemmed
      ? {
          x: space(centreX + STEM_X),
          from: space(centreY),
          to: space(centreY - STEM_LENGTH),
          width: Math.max(1, space(STEM_THICKNESS)),
        }
      : null,
    flag: flag ? { glyph: flag, x: space(centreX + STEM_X), y: space(centreY - STEM_LENGTH) } : null,
    dot: dotted
      ? { glyph: AUGMENTATION_DOT, x: space(centreX + halfWidth + DOT_GAP), y: space(centreY) }
      : null,
  };
}
