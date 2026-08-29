import type { Clef } from '../../data/types';

/**
 * Where every mark on a few bars of notation goes.
 *
 * Pure geometry, no drawing. Engraving is the kind of thing that looks right
 * until a viola part arrives and every note sits a third off, so the arithmetic
 * lives on its own where it can be checked a note at a time.
 *
 * **Scope, stated honestly.** This engraves a single line of music across as
 * many systems as it takes: noteheads, stems, beamed eighths, ledger lines,
 * inline sharps, barlines and the note names underneath. It is not a score
 * engraver — no key signatures, no slurs, no dynamics, no chords, no rests. It
 * exists to draw the daily warmup, whose notes this app authors, and the
 * warmups are written to stay inside what it can draw.
 *
 * **It draws no clef**, and that is a decision rather than an omission. A clef
 * is a piece of calligraphy; a hand-approximated treble clef in an app for
 * classical musicians would be the first thing a reader noticed and the last
 * thing they forgave. Honest about being an exercise diagram rather than
 * pretending to be engraved sheet music.
 *
 * Something else therefore has to say which clef these positions are in, or the
 * same notehead means a different pitch to a violist than to a violinist. Two
 * callers answer it two ways, and `nameRow` selects between them: the warmup
 * prints the note names under each system, the way a study book does, and the
 * screen names the instrument; a screen for reading a real piece turns the names
 * off — they read as a beginner's crib on repertoire — and states the clef as
 * score metadata instead. What is not acceptable is neither.
 */

/** Diatonic steps above C0 — the unit the staff actually measures in. */
const LETTERS: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/**
 * A pitch name, as the server spells one.
 *
 * `##` and `bb` before `#` and `b`, because an alternation takes the first
 * branch that matches: the single-accidental branch first matches `F#` out of
 * `F##4`, leaves `#4` unconsumed, fails the anchor, and returns null for a
 * pitch that is perfectly well formed. The server's `PITCH_PATTERN` carries the
 * same ordering and the same note.
 */
const PITCH = /^([A-G])(##|bb|#|b)?(-?\d+)$/;

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

export interface StaveNote {
  /** Scientific pitch, e.g. `D4`, `F#4`. Flats are not drawn — see `Accidental`. */
  pitch: string;
  value: NoteValue;
  /** Starts a new bar before this note. */
  barBefore?: boolean;
  /**
   * Which bar of the score this came from, when the caller knows.
   *
   * Only so a playhead can say where it is. The warmup, which authors its own
   * notes, has no measure numbers to give and omits it.
   */
  measureNumber?: number;
}

/**
 * A rest, of the four values this engraver draws.
 *
 * **Silence is music and was being deleted.** `fromScore` counted rests and
 * drew none, so on the orchestral part fixture six of nineteen bars vanished
 * from the stave and the note before the silence sat next to the note after
 * it. A bass part is mostly rests; a picture of one that shows only the notes
 * is not a picture of the part.
 */
export interface StaveRest {
  rest: NoteValue;
  barBefore?: boolean;
  measureNumber?: number;
}

/**
 * One symbol standing for several bars of silence — what an orchestral part
 * prints, and what a musician actually counts.
 *
 * The backend expands `<multiple-rest>20</multiple-rest>` into twenty bars of
 * whole rest, which is what keeps the timeline from running twenty bars early.
 * Drawing twenty empty bars would be honest and useless: nobody counts twenty
 * barlines on a phone. This is the printed form put back.
 */
export interface StaveMultiRest {
  /** How many bars of silence. Printed above the block. */
  bars: number;
  barBefore?: boolean;
  measureNumber?: number;
}

export type StaveItem = StaveNote | StaveRest | StaveMultiRest;

export function isRest(item: StaveItem): item is StaveRest {
  return 'rest' in item;
}

export function isMultiRest(item: StaveItem): item is StaveMultiRest {
  return 'bars' in item;
}

export function isNote(item: StaveItem): item is StaveNote {
  return 'pitch' in item;
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
  /** The note's letter and accidental, for the row under the system. */
  name: string;
}

/**
 * Where a rest sits, and of what value. **Position only** — the shapes live in
 * `Stave.tsx`, the same division the noteheads already follow.
 *
 * `y` is the staff line the glyph is drawn *against*, which differs per value
 * and is the part that is easy to get wrong: a whole rest hangs below the
 * second line from the top, a half rest sits on the middle line, and the two
 * are otherwise identical rectangles. Drawn the same way round, every bar of
 * rest in the app would be a beat wrong to anyone who reads music.
 */
export interface EngravedRest {
  x: number;
  y: number;
  value: NoteValue;
}

/** A multi-bar rest: the block, and where its number goes. */
export interface EngravedMultiRest {
  /** Left end of the block. */
  x: number;
  width: number;
  /** Centre of the block — the middle staff line. */
  y: number;
  /** Half the block's height, so the caller can draw its end serifs. */
  halfHeight: number;
  bars: number;
  /** Baseline for the number printed above the staff. */
  numberY: number;
}

/** One bar's horizontal extent on a system. */
export interface MeasureSpan {
  measureNumber: number;
  from: number;
  to: number;
}

export interface EngravedBeam {
  from: number;
  to: number;
  y: number;
  /** Beams follow their stems, so they sit under down-stemmed groups. */
  stemUp: boolean;
}

export interface EngravedSystem {
  /** Y of each of the five staff lines, top first. Absolute in the drawing. */
  staffLines: number[];
  /** X of each barline, including the one that ends the system. */
  barlines: number[];
  notes: EngravedNote[];
  rests: EngravedRest[];
  multiRests: EngravedMultiRest[];
  /**
   * Where each bar sits on this system, for a playhead to sit behind.
   *
   * Derived here rather than in the component because the component does not
   * know which item belongs to which bar — it draws a flat list of positions,
   * and reconstructing the grouping from the barlines would be a second copy
   * of arithmetic this loop already does.
   *
   * A bar that spans a system break appears on both, each time covering the
   * part of it that is on that system, which is what a musician reading it
   * sees too.
   */
  measureSpans: MeasureSpan[];
  beams: EngravedBeam[];
  /** Baseline for the note names printed under this system. */
  nameY: number;
  /** Right edge of this system's staff lines. */
  width: number;
}

export interface Engraving {
  width: number;
  height: number;
  systems: EngravedSystem[];
}

export interface EngraveOptions {
  /** Distance between adjacent staff lines. Everything scales from this. */
  lineGap?: number;
  /** Horizontal distance between noteheads. */
  noteGap?: number;
  /** Space before the first note of a system. */
  leftPad?: number;
  rightPad?: number;
  /**
   * Wrap onto a new system past this width.
   *
   * Wrapping rather than scrolling sideways, because an exercise you have to
   * swipe through is one you cannot read while holding a bow. Omitted means a
   * single system however long it runs — which is what the Today preview
   * wants, since it is clipped deliberately.
   */
  maxWidth?: number;
  /** Cap on notes drawn. Applied before wrapping. */
  maxNotes?: number;
  /**
   * Stretch each system to fill `maxWidth`.
   *
   * What an engraver calls justification, and the reason a printed page has
   * flush right margins. Without it a system holding two bars stops a
   * quarter of the way short of the next one and the block reads as ragged
   * rather than as music. Ignored without a `maxWidth` to stretch to.
   */
  justify?: boolean;
  /**
   * Reserve the row of note names beneath each system.
   *
   * On by default, because the warmup — the reason this engraver exists —
   * prints them: it is an exercise for a student, and the letters teach.
   *
   * Off for reading a real piece, where fifteen letters under the notes is
   * clutter that implies the reader cannot read music. **Turning it off means
   * the clef has to be stated somewhere else**, since nothing here draws one
   * and the names were carrying that information (see the note on
   * `MIDDLE_LINE_STEP`). `PieceScoreScreen` prints it as score metadata, which
   * is where a clef belongs on a screen for reading music.
   *
   * This only governs the space reserved for the row; `nameY` is still
   * returned, so a caller that wants the geometry can have it.
   */
  nameRow?: boolean;
}

/** Half the notehead's height, in staff gaps. Mirrors `Stave`'s HEAD_RY. */
const HEAD_RADIUS_FACTOR = 0.46;
/** Breathing room around the drawing, in staff gaps. */
const PADDING_FACTOR = 0.7;
/** Height reserved under each system for its row of note names. */
const NAME_ROW_FACTOR = 2.2;

/** Breathing room below the lowest ink when no names are drawn, in staff gaps. */
const BARE_BOTTOM_FACTOR = 0.8;
/** Gap between one system's names and the next system's staff. */
const SYSTEM_GAP_FACTOR = 1.6;
/** Stem length, in staff gaps. An octave, which is the engraver's convention. */
const STEM_FACTOR = 3.5;

/**
 * How much of a column a multi-bar rest's block fills.
 *
 * Wider than a notehead by a long way, because that is the point: it has to
 * read as a *stretch of silence* from across the room and not as another
 * symbol on the line. One column, though — the layout is even columns and
 * inventing a wider one for this would push the wrap arithmetic out of step
 * with what it draws.
 */
const MULTI_REST_WIDTH_FACTOR = 0.72;
const MULTI_REST_HEIGHT_FACTOR = 0.95;
/** The number sits above the top staff line, clear of it. */
const MULTI_REST_NUMBER_FACTOR = 1.1;
/**
 * How far justification may stretch the note spacing.
 *
 * A final system holding one bar would otherwise spread four notes across the
 * page, which looks like a mistake rather than a line ending.
 */
const MAX_JUSTIFY_STRETCH = 1.5;

const DEFAULTS = {
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
/**
 * The glyph to draw before a notehead, if this engraver has one.
 *
 * Only the single sharp. Flats have never been drawn — the note sits at its
 * diatonic position and the name row under the system carries the accidental —
 * and doubles join them rather than borrowing the sharp glyph: `F##` drawn with
 * one sharp is a different note, printed as though it were right, which is the
 * failure this module's own docstring is written against.
 *
 * The position is still correct in every case, because `stepOf` reads the
 * letter and ignores the accidental. So a double accidental loses its symbol
 * and nothing else, exactly as a flat does today.
 */
export function accidentalOf(pitch: string): Accidental {
  const match = PITCH.exec(pitch);
  if (!match) {
    return null;
  }
  return match[2] === '#' ? 'sharp' : null;
}

/** `F#4` reads as `F♯` — the octave is on the staff, and the sharp is a glyph. */
export function displayName(pitch: string): string {
  // Every sharp, not the first: the replace was un-anchored and ungreedy, so
  // `F##4` read back as `F♯#` — half converted, and the half left behind is
  // the character this row exists to spell out.
  return pitch.replace(/#/g, '♯').replace(/-?\d+$/, '');
}

/** Split a run of notes into bars, using the `barBefore` flags. */
export function splitBars(notes: StaveItem[]): StaveItem[][] {
  const bars: StaveItem[][] = [];
  for (const note of notes) {
    if (note.barBefore || bars.length === 0) {
      bars.push([]);
    }
    bars[bars.length - 1].push(note);
  }
  return bars;
}

/**
 * Pack bars onto systems.
 *
 * Whole bars only. Breaking a bar across a line break is legal in engraving and
 * wrong here: these are counting exercises, and a bar read across a fold is a
 * bar miscounted. A bar too wide for a system on its own gets a system of its
 * own and overflows rather than being split.
 */
export function packSystems(
  bars: StaveItem[][],
  notesPerSystem: number,
): StaveItem[][] {
  const systems: StaveItem[][] = [];
  let current: StaveItem[] = [];

  for (const bar of bars) {
    if (current.length > 0 && current.length + bar.length > notesPerSystem) {
      systems.push(current);
      current = [];
    }
    current = current.concat(bar);
  }
  if (current.length > 0) {
    systems.push(current);
  }
  return systems;
}

/**
 * Lay out one system, in its own coordinate space.
 *
 * The middle staff line is 0 here; the caller shifts the whole thing once it
 * knows how tall the system turned out to be.
 */
function layoutSystem(
  notes: StaveItem[],
  clef: Clef,
  lineGap: number,
  noteGap: number,
  leftPad: number,
  rightPad: number,
  nameRow: boolean,
): { system: EngravedSystem; top: number; bottom: number } {
  const halfGap = lineGap / 2;
  const middleStep = MIDDLE_LINE_STEP[clef];
  const staffLines = [-2, -1, 0, 1, 2].map((i) => i * lineGap);
  const engravedNotes: EngravedNote[] = [];
  const engravedRests: EngravedRest[] = [];
  const multiRests: EngravedMultiRest[] = [];
  const barlines: number[] = [];
  const beams: EngravedBeam[] = [];
  const stemLength = lineGap * STEM_FACTOR;

  let x = leftPad;
  // Where each bar starts and stops on this system. Tracked as the loop walks
  // because only the loop knows which item belongs to which bar.
  const measureSpans: MeasureSpan[] = [];
  let spanFrom = leftPad - noteGap / 2;
  let spanMeasure: number | undefined;

  function closeSpan(to: number) {
    if (spanMeasure !== undefined) {
      measureSpans.push({ measureNumber: spanMeasure, from: spanFrom, to });
    }
  }

  notes.forEach((item, index) => {
    if (item.barBefore && index > 0) {
      // The line sits midway in the gap it interrupts, so it belongs to
      // neither of the notes on either side.
      barlines.push(x - noteGap / 2);
      closeSpan(x - noteGap / 2);
      spanFrom = x - noteGap / 2;
      spanMeasure = undefined;
    }
    if (spanMeasure === undefined) {
      spanMeasure = item.measureNumber;
    }

    if (isMultiRest(item)) {
      const width = noteGap * MULTI_REST_WIDTH_FACTOR;
      multiRests.push({
        x: x - width / 2,
        width,
        y: 0,
        halfHeight: (lineGap * MULTI_REST_HEIGHT_FACTOR) / 2,
        bars: item.bars,
        numberY: staffLines[0] - lineGap * MULTI_REST_NUMBER_FACTOR,
      });
      x += noteGap;
      return;
    }

    if (isRest(item)) {
      // Whole hangs below the second line from the top; half sits on the
      // middle line; quarter and eighth are centred on the staff. `y` is the
      // line each is drawn against, not the middle of the glyph — see
      // `EngravedRest`.
      const y =
        item.rest === 'whole'
          ? staffLines[1]
          : item.rest === 'half'
            ? 0
            : 0;
      engravedRests.push({ x, y, value: item.rest });
      x += noteGap;
      return;
    }

    const note = item;
    // `staveScoreFor` has already dropped anything whose step cannot be read,
    // so this is a total rather than a fallback. It was `step === null ? 0`,
    // which put a note nobody could place **on the middle line** under a name
    // it did not have — the pitch equivalent of drawing a sixteenth as an
    // eighth, and the thing this module's own docstring forbids: "Drawing less
    // and admitting it is honest; drawing something else is not."
    const step = stepOf(note.pitch) ?? 0;
    const y = -(step - middleStep) * halfGap;
    const stemUp = y > 0;
    const filled = note.value === 'quarter' || note.value === 'eighth';

    engravedNotes.push({
      x,
      y,
      filled,
      stemUp,
      accidental: accidentalOf(note.pitch),
      name: displayName(note.pitch),
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
      ledgers: ledgerLinesFor(y, staffLines[0], staffLines[4], lineGap),
    });

    x += noteGap;
  });

  const right = x - noteGap / 2 + rightPad;
  barlines.push(right);
  closeSpan(x - noteGap / 2);

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

  // Walked over the *items* while counting into `engravedNotes`, because a
  // rest occupies a column and produces no notehead — so the two indices
  // stopped being the same the moment silence could be drawn. Beaming by item
  // index would have joined a beam to whichever notehead happened to sit at
  // that position, which on a part with rests in it is a different note.
  let noteAt = 0;
  notes.forEach((item) => {
    if (!isNote(item)) {
      // **A rest breaks a beam**, which is engraving and not an accident of
      // this loop: a beam over a silence would group notes that are not a
      // group. A multi-bar rest breaks it for the same reason, twenty times
      // over.
      flush();
      return;
    }
    const index = noteAt;
    noteAt += 1;
    if (item.value === 'eighth' && !(item.barBefore && run.length > 0)) {
      run.push(index);
      return;
    }
    flush();
    if (item.value === 'eighth') {
      run.push(index);
    }
  });
  flush();

  // The real extent, not an estimate: stems and ledger lines both reach
  // outside the staff, and a box sized from the noteheads alone clips exactly
  // the tall notes an exercise is written to practise.
  const extents = [staffLines[0], staffLines[4]];
  for (const note of engravedNotes) {
    extents.push(
      note.y - HEAD_RADIUS_FACTOR * lineGap,
      note.y + HEAD_RADIUS_FACTOR * lineGap,
    );
    if (note.stem) {
      extents.push(note.stem.to);
    }
    extents.push(...note.ledgers);
  }

  // Rests reach outside the noteheads' box too — a quarter rest spans the
  // staff, and a multi-bar rest's number sits above the top line. A box sized
  // from the notes alone clips the number, which is the only part of a
  // multi-bar rest a musician actually reads.
  for (const rest of engravedRests) {
    extents.push(rest.y - lineGap, rest.y + lineGap);
  }
  for (const block of multiRests) {
    extents.push(block.numberY - lineGap * MULTI_REST_NUMBER_FACTOR, block.y + block.halfHeight);
  }

  const nameY = Math.max(...extents) + lineGap * NAME_ROW_FACTOR;

  return {
    system: {
      staffLines,
      barlines,
      notes: engravedNotes,
      rests: engravedRests,
      multiRests,
      measureSpans,
      beams,
      nameY,
      width: right,
    },
    top: Math.min(...extents),
    // Without the name row the system ends just below its lowest ink, plus
    // enough to keep a low ledger line off the next system. Returning `nameY`
    // regardless would leave a band of empty space under every system —
    // reserved for labels that are not being drawn.
    bottom: nameRow ? nameY : Math.max(...extents) + lineGap * BARE_BOTTOM_FACTOR,
  };
}

/** Shift every coordinate in a system down by `dy`. */
function shift(system: EngravedSystem, dy: number): EngravedSystem {
  return {
    staffLines: system.staffLines.map((y) => y + dy),
    barlines: system.barlines,
    nameY: system.nameY + dy,
    width: system.width,
    notes: system.notes.map((note) => ({
      ...note,
      y: note.y + dy,
      ledgers: note.ledgers.map((y) => y + dy),
      stem: note.stem
        ? { ...note.stem, from: note.stem.from + dy, to: note.stem.to + dy }
        : null,
    })),
    // Spans are horizontal only, so a vertical shift leaves them alone.
    measureSpans: system.measureSpans,
    rests: system.rests.map((rest) => ({ ...rest, y: rest.y + dy })),
    multiRests: system.multiRests.map((block) => ({
      ...block,
      y: block.y + dy,
      numberY: block.numberY + dy,
    })),
    beams: system.beams.map((beam) => ({ ...beam, y: beam.y + dy })),
  };
}

/**
 * Lay out a run of notes, wrapping onto as many systems as it takes.
 *
 * Notes are evenly spaced rather than spaced by duration. Proportional spacing
 * is what a real engraver does and it is wrong here: these are exercises read
 * at a glance on a phone, and even columns make the beat positions obvious,
 * which is the whole point of a rhythm exercise.
 */
export function engrave(
  notes: StaveItem[],
  clef: Clef,
  options: EngraveOptions = {},
): Engraving {
  const lineGap = options.lineGap ?? DEFAULTS.lineGap;
  const noteGap = options.noteGap ?? DEFAULTS.noteGap;
  const leftPad = options.leftPad ?? DEFAULTS.leftPad;
  const rightPad = options.rightPad ?? DEFAULTS.rightPad;
  const nameRow = options.nameRow ?? true;

  const capped = options.maxNotes ? truncateAtBar(notes, options.maxNotes) : notes;

  const perSystem = options.maxWidth
    ? Math.max(1, Math.floor((options.maxWidth - leftPad - rightPad) / noteGap))
    : capped.length;
  const runs = options.maxWidth ? packSystems(splitBars(capped), perSystem) : [capped];

  const padding = PADDING_FACTOR * lineGap;
  const gap = lineGap * SYSTEM_GAP_FACTOR;

  const systems: EngravedSystem[] = [];
  let cursor = padding;
  let width = 0;

  for (const run of runs) {
    if (run.length === 0) {
      continue;
    }
    // A system's width is leftPad + (n - ½) gaps + rightPad, because the final
    // barline sits half a gap past the last note. Solve that for the gap that
    // makes it exactly `maxWidth`.
    const stretched =
      options.justify && options.maxWidth && run.length > 1
        ? Math.min(
            (options.maxWidth - leftPad - rightPad) / (run.length - 0.5),
            noteGap * MAX_JUSTIFY_STRETCH,
          )
        : noteGap;
    const laid = layoutSystem(run, clef, lineGap, stretched, leftPad, rightPad, nameRow);
    systems.push(shift(laid.system, cursor - laid.top));
    cursor += laid.bottom - laid.top + gap;
    width = Math.max(width, laid.system.width);
  }

  // Staff lines run to a common right margin.
  //
  // Without this a short final system draws a stub staff — the 3-bar case puts
  // one whole note on a stave a fifth of the column wide, which reads as a
  // rendering failure rather than as a line of music ending. Justification
  // cannot fix it: `MAX_JUSTIFY_STRETCH` deliberately refuses to spread one
  // note across a page, and it is right to refuse.
  //
  // So the *paper* is squared off while the *music* is left alone. Notes keep
  // the positions they were given, and the closing barline stays where the
  // music actually stops — the staff simply carries on past it to the margin,
  // the way pre-printed manuscript paper does under a written-out exercise.
  // Moving the barline to the margin instead would invent an empty bar.
  //
  // Only when there is a column to square off against. Without `maxWidth` there
  // is no margin to reach, and the Today preview — one system, clipped on
  // purpose — must keep its natural width.
  const flush = options.maxWidth
    ? systems.map((system) => ({ ...system, width }))
    : systems;

  return {
    width,
    // The last system needs no inter-system gap, only the outer padding.
    height: Math.max(cursor - gap + padding, padding * 2),
    systems: flush,
  };
}

/**
 * Cut a run of notes down, preferring to stop where a bar does.
 *
 * A preview that ends halfway through a bar reads as a rendering failure
 * rather than as an extract, so this drops back to the last barline inside the
 * limit — unless that would leave almost nothing, in which case a hard cut is
 * the lesser problem.
 */
export function truncateAtBar(notes: StaveItem[], limit: number): StaveItem[] {
  if (notes.length <= limit) {
    return notes;
  }
  const head = notes.slice(0, limit);
  for (let i = head.length - 1; i > 0; i -= 1) {
    if (head[i].barBefore) {
      return i >= limit / 2 ? head.slice(0, i) : head;
    }
  }
  return head;
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
