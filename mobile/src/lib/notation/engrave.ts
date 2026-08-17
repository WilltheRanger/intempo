import type { Clef } from '../../data/types';

/**
 * Where every mark on a short excerpt goes.
 *
 * Pure geometry, no drawing. Engraving is the kind of thing that looks right
 * until a viola part arrives and every note sits a third off, so the arithmetic
 * lives on its own where it can be checked a note at a time.
 *
 * **Scope, stated honestly.** This engraves a few bars of a single line:
 * noteheads, stems, beamed eighths, ledger lines, inline sharps and barlines.
 * It is not a score engraver — no key signatures, no slurs, no dynamics, no
 * chords, no rests. It exists to draw the daily excerpt, whose notes this app
 * authors, and the excerpts are written to stay inside what it can draw.
 *
 * **It draws no clef**, and that is a decision rather than an omission. A clef
 * is a piece of calligraphy; a hand-approximated treble clef in an app for
 * classical musicians would be the first thing a reader noticed and the last
 * thing they forgave. The pitches are instead disambiguated the way a study
 * book does it — the note names are printed under the staff — and the block
 * names the instrument it is written for. Honest about being an exercise
 * diagram rather than pretending to be engraved sheet music.
 */

/** Diatonic steps above C0 — the unit the staff actually measures in. */
const LETTERS: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

const PITCH = /^([A-G])(#|b)?(-?\d+)$/;

/**
 * The step sitting on each clef's middle line.
 *
 * Treble's middle line is B4, bass's is D3, alto's is C4, tenor's is A3. Every
 * vertical position on the staff is derived from these four numbers, which is
 * why they are written out rather than computed from a clef's octave.
 */
const MIDDLE_LINE_STEP: Record<Clef, number> = {
  treble: 4 * 7 + LETTERS.B,
  bass: 3 * 7 + LETTERS.D,
  alto: 4 * 7 + LETTERS.C,
  tenor: 3 * 7 + LETTERS.A,
};

export type NoteValue = 'whole' | 'half' | 'quarter' | 'eighth';

export interface ExcerptNote {
  /** Scientific pitch, e.g. `D4`, `F#4`. Flats are not drawn — see `Accidental`. */
  pitch: string;
  value: NoteValue;
  /** Starts a new bar before this note. */
  barBefore?: boolean;
}

export type Accidental = 'sharp' | 'natural' | null;

export interface EngravedNote {
  x: number;
  /** Centre of the notehead. */
  y: number;
  filled: boolean;
  /** Whole notes carry none. */
  stem: { x: number; from: number; to: number } | null;
  stemUp: boolean;
  accidental: Accidental;
  /** Y positions of ledger lines this note needs, above or below the staff. */
  ledgers: number[];
}

export interface EngravedBeam {
  from: number;
  to: number;
  y: number;
  /** Beams follow their stems, so they sit under down-stemmed groups. */
  stemUp: boolean;
}

export interface Engraving {
  width: number;
  height: number;
  /**
   * Shift every y by this before drawing.
   *
   * The layout is computed in its own space and then trimmed to what it
   * actually occupies, so a run of low notes doesn't leave a band of empty
   * staff above it. Applied once as a group transform rather than folded into
   * every coordinate, so the numbers above stay readable as staff positions.
   */
  offsetY: number;
  /** Y of each of the five staff lines, top first. */
  staffLines: number[];
  /** X of each barline, including the final one. */
  barlines: number[];
  notes: EngravedNote[];
  beams: EngravedBeam[];
}

export interface EngraveOptions {
  /** Distance between adjacent staff lines. Everything scales from this. */
  lineGap?: number;
  /** Horizontal distance between noteheads. */
  noteGap?: number;
  /** Space before the first note. */
  leftPad?: number;
  rightPad?: number;
}

/** Half the notehead's height, in staff gaps. Mirrors `Stave`'s HEAD_RY. */
const HEAD_RADIUS_FACTOR = 0.46;
/** Breathing room around the drawing, in staff gaps. */
const PADDING_FACTOR = 0.7;

const DEFAULTS: Required<EngraveOptions> = {
  lineGap: 9,
  noteGap: 30,
  leftPad: 22,
  rightPad: 12,
};

/** Diatonic step of a pitch, ignoring its accidental. */
export function stepOf(pitch: string): number | null {
  const match = PITCH.exec(pitch);
  if (!match) {
    return null;
  }
  const [, letter, , octave] = match;
  return Number(octave) * 7 + LETTERS[letter];
}

/** The accidental to print before a note, or null. */
export function accidentalOf(pitch: string): Accidental {
  const match = PITCH.exec(pitch);
  if (!match) {
    return null;
  }
  return match[2] === '#' ? 'sharp' : null;
}

/**
 * Lay out an excerpt.
 *
 * Notes are evenly spaced rather than spaced by duration. Proportional spacing
 * is what a real engraver does and it is wrong here: these are exercises read
 * at a glance on a phone, and even columns make the beat positions obvious,
 * which is the whole point of a rhythm exercise.
 */
export function engrave(
  notes: ExcerptNote[],
  clef: Clef,
  options: EngraveOptions = {},
): Engraving {
  const { lineGap, noteGap, leftPad, rightPad } = { ...DEFAULTS, ...options };
  const halfGap = lineGap / 2;

  const staffHeight = lineGap * 4;
  // Enough headroom for a stem and two ledger lines above the staff. The box
  // is trimmed to the real extent at the end, so this only has to be a
  // starting offset that nothing draws above.
  const topLine = lineGap * 5;
  const staffLines = Array.from({ length: 5 }, (_, i) => topLine + i * lineGap);
  const middleLine = topLine + staffHeight / 2;
  const middleStep = MIDDLE_LINE_STEP[clef];

  const engravedNotes: EngravedNote[] = [];
  const barlines: number[] = [];
  const beams: EngravedBeam[] = [];

  let x = leftPad;

  notes.forEach((note, index) => {
    if (note.barBefore && index > 0) {
      // The line sits midway in the gap it interrupts, so it belongs to
      // neither of the notes on either side.
      barlines.push(x - noteGap / 2);
    }

    const step = stepOf(note.pitch);
    const y = step === null ? middleLine : middleLine - (step - middleStep) * halfGap;
    const stemUp = y > middleLine;
    const filled = note.value === 'quarter' || note.value === 'eighth';
    const stemLength = lineGap * 3.5;

    engravedNotes.push({
      x,
      y,
      filled,
      stemUp,
      accidental: accidentalOf(note.pitch),
      stem:
        note.value === 'whole'
          ? null
          : {
              // Stems rise from the right of the notehead and fall from the
              // left. Centring them is the single most obvious tell that
              // notation was drawn by someone who doesn't read it.
              x: stemUp ? x + lineGap * 0.62 : x - lineGap * 0.62,
              from: y,
              to: stemUp ? y - stemLength : y + stemLength,
            },
      ledgers: ledgerLinesFor(y, topLine, staffLines[4], lineGap),
    });

    x += noteGap;
  });

  barlines.push(x - noteGap + noteGap / 2 + rightPad / 2);

  // Beam runs of eighths, broken at barlines: a beam across a barline would
  // group notes that are in different bars.
  let run: number[] = [];
  const flush = () => {
    if (run.length > 1) {
      const group = run.map((i) => engravedNotes[i]);
      const stemUp = group[0].stemUp;
      // All stems in a beamed group point the same way and reach the same
      // line — the extreme note decides, and the rest are lengthened to meet.
      const beamY = stemUp
        ? Math.min(...group.map((n) => n.stem!.to))
        : Math.max(...group.map((n) => n.stem!.to));
      for (const n of group) {
        n.stemUp = stemUp;
        n.stem = {
          x: stemUp ? n.x + lineGap * 0.62 : n.x - lineGap * 0.62,
          from: n.y,
          to: beamY,
        };
      }
      beams.push({
        from: group[0].stem!.x,
        to: group[group.length - 1].stem!.x,
        y: beamY,
        stemUp,
      });
    }
    run = [];
  };

  notes.forEach((note, index) => {
    if (note.value === 'eighth' && !(note.barBefore && run.length > 0)) {
      run.push(index);
      return;
    }
    flush();
    if (note.value === 'eighth') {
      run.push(index);
    }
  });
  flush();

  // The real extent of the drawing, not an estimate: stems and ledger lines
  // both reach outside the staff, and a box sized from the noteheads alone
  // clips exactly the tall notes an exercise is written to practise.
  const extents = [topLine, staffLines[4]];
  for (const note of engravedNotes) {
    extents.push(note.y - HEAD_RADIUS_FACTOR * lineGap, note.y + HEAD_RADIUS_FACTOR * lineGap);
    if (note.stem) {
      extents.push(note.stem.to);
    }
    extents.push(...note.ledgers);
  }
  const lowest = Math.max(...extents);
  const highest = Math.min(...extents);

  return {
    width: x - noteGap + noteGap / 2 + rightPad,
    height: lowest - highest + PADDING_FACTOR * lineGap * 2,
    offsetY: PADDING_FACTOR * lineGap - highest,
    staffLines,
    barlines,
    notes: engravedNotes,
    beams,
  };
}

/**
 * Ledger lines for a note outside the staff.
 *
 * Only for notes on or beyond the first line out — a note in the space just
 * above the staff needs none, and drawing one there is a common mistake.
 */
function ledgerLinesFor(
  y: number,
  topLine: number,
  bottomLine: number,
  lineGap: number,
): number[] {
  const lines: number[] = [];
  for (let at = topLine - lineGap; at >= y - 0.01; at -= lineGap) {
    lines.push(at);
  }
  for (let at = bottomLine + lineGap; at <= y + 0.01; at += lineGap) {
    lines.push(at);
  }
  return lines;
}
