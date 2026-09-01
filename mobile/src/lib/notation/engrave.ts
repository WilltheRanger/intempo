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
/**
 * Which staff line each clef names, measured in **lines from the middle one**.
 *
 * A clef is not a decoration placed near the staff; it is a letter drawn
 * around one specific line, and that line is what makes every other position
 * mean something. The G clef's spiral centres on the G line (one below the
 * middle in treble), the F clef's two dots straddle the F line (one above the
 * middle in bass), and the C clef's waist is the middle line itself.
 *
 * Positive is upward, which is the opposite of screen `y` — the caller negates.
 */
const CLEF_LINE: Record<Clef, number> = {
  treble: -1,
  bass: 1,
  alto: 0,
  tenor: 1,
};

const MIDDLE_LINE_STEP: Record<Clef, number> = {
  treble: 4 * 7 + LETTERS.B,
  bass: 3 * 7 + LETTERS.D,
  alto: 4 * 7 + LETTERS.C,
  tenor: 3 * 7 + LETTERS.A,
};

/**
 * The note values this engraver can draw.
 *
 * **`sixteenth` was the single commonest thing it could not.** Measured across
 * the corpus by `tools/engraver-coverage.py`: 30 of the 53 notes with no glyph
 * were sixteenths, and the worst page drew 40% of its notes. A stave missing
 * three notes in five is not a stave of that music.
 *
 * Dots are not values here — they are a flag on the note (`dots`), because
 * `dotted_quarter` and `quarter` are the same notehead and the same stem with
 * one extra mark, and enumerating every combination doubles this union for no
 * gain.
 */
export type NoteValue = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';

/**
 * How long each value lasts, in quarter notes.
 *
 * Only beam grouping needs this — the engraver otherwise measures in columns,
 * not in time. Kept here beside `TAILS` so a value added to `NoteValue` has to
 * answer both questions at once.
 */
export const QUARTERS: Record<NoteValue, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
};

/** How many beams or flags a value carries. Whole, half and quarter carry none. */
export const TAILS: Record<NoteValue, number> = {
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  sixteenth: 2,
};

export interface StaveNote {
  /** Scientific pitch, e.g. `D4`, `F#4`. Flats are not drawn — see `Accidental`. */
  pitch: string;
  value: NoteValue;
  /** Augmentation dots, 0 or 1. A dotted quarter is `quarter` with `dots: 1`. */
  dots?: number;
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

export type Accidental =
  | 'sharp'
  | 'flat'
  | 'natural'
  | 'double-sharp'
  | 'double-flat'
  | null;

/**
 * How wide each accidental is, in staff spaces.
 *
 * Bravura's own advance widths, read out of the font rather than estimated: a
 * double flat is **1.65 spaces**, nearly twice a sharp, and a natural is two
 * thirds of one. One width standing in for all five — which is what the fixed
 * constant this replaced amounted to — puts a double flat through the notehead
 * it belongs to and leaves a natural floating.
 */
export const ACCIDENTAL_WIDTHS: Record<NonNullable<Accidental>, number> = {
  sharp: 0.996,
  flat: 0.904,
  natural: 0.672,
  'double-sharp': 1.0,
  'double-flat': 1.652,
};

export interface EngravedNote {
  x: number;
  /** Centre of the notehead. */
  y: number;
  /**
   * Which notehead to draw.
   *
   * `filled` says black or hollow; this says *which* hollow one. A whole note's
   * head is 1.69 staff spaces wide and a half's is 1.18 — the same shape at the
   * same size for both is a whole note drawn too narrow or a half drawn too
   * fat, and at a glance the wrong one of the two.
   */
  value: NoteValue;
  filled: boolean;
  /** Whole notes carry none. */
  stem: { x: number; from: number; to: number } | null;
  stemUp: boolean;
  accidental: Accidental;
  /** Centre of the accidental, when there is one. Meaningless when there isn't. */
  accidentalX: number;
  /** Y positions of ledger lines this note needs, above or below the staff. */
  ledgers: number[];
  /** The note's letter and accidental, for the row under the system. */
  name: string;
  /**
   * Augmentation dots printed after the notehead. 0 or 1.
   *
   * A dot adds half the note's value again, and leaving it off turns a dotted
   * quarter into a quarter — a shorter note drawn as though the page said so,
   * which is the failure this module is written against.
   */
  dots: number;
  /**
   * Flags on an unbeamed note: 1 for an eighth, 2 for a sixteenth, 0 otherwise.
   *
   * **Set for every note first and cleared when a beam claims it.** Beams were
   * only ever emitted for runs of two or more, so a lone eighth — one between
   * rests, or at the end of a bar — was drawn as a filled notehead with a plain
   * stem, which is a *quarter*. It read as a note twice its length and nothing
   * said otherwise.
   */
  flags: number;
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

/**
 * One beam line, at one level, over one run of stems.
 *
 * **A group can need several of these, and that is the whole point.** This used
 * to be a single beam per group carrying a `count`, drawn as that many parallel
 * lines across the entire run — which is right only when every note in the run
 * is the same value. A dotted eighth followed by a sixteenth is the commonest
 * rhythm in string writing and the commonest counter-example: two full beams
 * across the pair says *both notes are sixteenths*, so the bar is drawn a beat
 * and a half short of what the page says, in the same confident ink as the bars
 * that are right.
 *
 * So level 1 spans the group, and each level above it spans only the notes that
 * actually carry it. A note carrying a level its neighbours do not gets a
 * **stub** — the short partial beam an engraver draws — pointing back toward
 * the note it shares a beat with.
 */
export interface EngravedBeam {
  /** 1 is the beam at the stem tips; 2 sits inside it, toward the noteheads. */
  level: number;
  from: number;
  to: number;
  /** Centre of this beam line, already offset for its level. */
  y: number;
  /** Beams follow their stems, so they sit under down-stemmed groups. */
  stemUp: boolean;
}

/**
 * Beam thickness, and centre-to-centre spacing, as fractions of `lineGap`.
 *
 * Exported because the engraver has to know the thickness to stack the levels
 * and the component has to know it to stroke them, and a second copy of a
 * number that decides where a line lands is how the two drift apart.
 */
export const BEAM_THICKNESS_FACTOR = 0.5;
const BEAM_PITCH = BEAM_THICKNESS_FACTOR * 1.5;

/** How far a stub reaches, capped so it never touches the next stem. */
const STUB_FACTOR = 1.1;

/**
 * How much room the opening of a system needs, in staff spaces.
 *
 * Bravura's own advance widths, plus the space an engraver leaves after each
 * element. They are constants rather than measurements because measuring text
 * in `react-native-svg` means a round trip through layout, and these glyphs
 * never change size relative to the staff — a SMuFL em *is* four staff spaces.
 */
const CLEF_WIDTH = 3.2;
/** A key-signature accidental's column. They are all sharps or all flats. */
const KEY_ACCIDENTAL_WIDTH = 1.0;
const TIME_WIDTH = 2.0;
/** Between the head and the first note, so the music does not touch the metre. */
const HEAD_GAP = 1.0;

/**
 * What every system opens with: clef, key signature, and — on the first
 * system only — the time signature.
 *
 * **The engraver drew none of these.** It said so and gave a reason: *"a clef
 * is a piece of calligraphy; a hand-approximated treble clef in an app for
 * classical musicians would be the first thing a reader noticed and the last
 * thing they forgave."* That reasoning was right and it is now answered rather
 * than accepted — `Stave` draws these from Bravura, the reference SMuFL font,
 * which is the same drawing MuseScore prints.
 *
 * A key signature was the more serious omission. `key_signature` has been read
 * off the page since Batch 2 and shown as *text*, so a piece in E major was
 * engraved with four accidentals missing from every system. That is a list of
 * pitches, not a line of music.
 *
 * Positions only. Which codepoint draws a sharp is presentation, and lives
 * with the thing that draws it.
 */
export interface EngravedHead {
  /**
   * The clef's baseline: `x` is its left edge, `y` the staff line it names —
   * a G clef curls around the G line, an F clef's dots straddle the F line.
   * Null when nothing knew the clef.
   */
  clef: { x: number; y: number } | null;
  /** Key accidentals in printing order, each centred on its own `y`. */
  key: { x: number; y: number; kind: 'sharp' | 'flat' }[];
  /**
   * The metre, on the first system only — which is where a page prints it, and
   * repeating it every line would read as a metre change.
   */
  time: { x: number; beats: number; unit: number } | null;
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
  /** Clef, key and metre at the left edge. Empty when none was asked for. */
  head: EngravedHead;
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
  /**
   * The beat beams break at, in quarter notes. One quarter unless said.
   *
   * A time signature, reduced to the only thing this file needs from it. 4/4
   * and 3/4 beam in quarters, cut time in halves, 6/8 in dotted quarters —
   * and the default is right for the warmup, which authors its own notes in
   * 4/4 and has no time signature to pass.
   */
  beatQuarters?: number;
  /**
   * Open every system with a clef and key signature, and the first with the
   * metre.
   *
   * Off unless asked for. The warmup draws a bare exercise stave and prints
   * note names underneath instead, which is what a study book does; a screen
   * for reading a real piece needs the page's own furniture.
   */
  head?: {
    /** Null when nothing read one, which `ScoreJson.clef` allows. */
    clef: Clef | null;
    key: { pitch: string; kind: 'sharp' | 'flat' }[];
    time: { beats: number; unit: number } | null;
  };
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

/**
 * How far left of its notehead an accidental's centre sits, in staff gaps.
 *
 * Moved here from the component with `accidentalX`: where a mark goes is
 * geometry, and the component had to know the notehead's own half-width to
 * place it, which is a second copy of a number this file already owns.
 */
const ACCIDENTAL_GAP = 0.28;

/** Half a notehead, which is what an accidental has to clear. */
const HEAD_HALF = 0.59;

/**
 * The extra column width a note carrying an accidental is given.
 *
 * **Because an accidental had no width at all**, and in a dense bar that is
 * not a near miss. Columns are evenly spaced, so a bar of sixteen sixteenths
 * on a phone gets about 1.6 staff gaps each — and a sharp drawn 1.55 gaps to
 * the left of its notehead therefore landed squarely on the *previous* note.
 * Four of them did, in the fixture study's opening bar, and every test passed.
 *
 * Even columns are the rule for *duration* — this file spaces a whole note and
 * a sixteenth alike on purpose, because these are read at a glance and even
 * columns make the beat obvious. That was never an argument for refusing an
 * accidental the room it physically occupies, which is what an engraver widens
 * a column for.
 */
/**
 * How much room an accidental asks for, in staff spaces, gaps included.
 * A double flat needs nearly twice what a sharp does.
 */
function accidentalRoom(accidental: Accidental): number {
  if (!accidental) {
    return 0;
  }
  return HEAD_HALF + ACCIDENTAL_GAP * 2 + ACCIDENTAL_WIDTHS[accidental];
}

/** How wide a system's opening is, so justification can spend what is left. */
function headRoom(head: HeadRequest | null, lineGap: number): number {
  if (!head) {
    return 0;
  }
  let width = 0;
  if (head.clef) {
    width += CLEF_WIDTH;
  }
  width += head.key.length * KEY_ACCIDENTAL_WIDTH;
  if (head.time) {
    width += TIME_WIDTH;
  }
  return width > 0 ? (width + HEAD_GAP) * lineGap : 0;
}

/** The room each item needs before it, beyond the ordinary column. */
function extraRoom(items: StaveItem[], lineGap: number): number[] {
  return items.map((item) =>
    isNote(item) ? lineGap * accidentalRoom(accidentalOf(item.pitch)) : 0,
  );
}

const DEFAULTS = {
  lineGap: 9,
  noteGap: 30,
  leftPad: 22,
  rightPad: 12,
  beatQuarters: 1,
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
 * The glyph to draw before a notehead.
 *
 * **All five now, where there used to be one.** This returned `'sharp'` or
 * nothing, and said why: the sharp was the only accidental that could be drawn
 * by hand, so a B♭ was engraved as a B and an F♯♯ as an F♯ — *"a different
 * note, printed as though it were right, which is the failure this module's own
 * docstring is written against."* The reasoning was right; the limitation was
 * the tooling, and Bravura removes it.
 *
 * The staff position was always correct, because `stepOf` reads the letter and
 * ignores the accidental. What was missing was the symbol that says which of
 * the two notes at that position is meant — and on a page where an editor
 * wrote a flat, that is not a detail.
 */
const ACCIDENTAL_BY_SUFFIX: Record<string, Accidental> = {
  '#': 'sharp',
  b: 'flat',
  '##': 'double-sharp',
  bb: 'double-flat',
};

export function accidentalOf(pitch: string): Accidental {
  const match = PITCH.exec(pitch);
  if (!match || !match[2]) {
    return null;
  }
  return ACCIDENTAL_BY_SUFFIX[match[2]] ?? null;
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
/** What a system opens with, before it is placed. */
export interface HeadRequest {
  /** Draw a clef. Null when nothing read one — see `ScoreJson.clef`. */
  clef: Clef | null;
  key: { pitch: string; kind: 'sharp' | 'flat' }[];
  /** Only the first system gets one; the caller decides which system that is. */
  time: { beats: number; unit: number } | null;
}

const NO_HEAD: EngravedHead = { clef: null, key: [], time: null };

function layoutSystem(
  notes: StaveItem[],
  clef: Clef,
  lineGap: number,
  noteGap: number,
  leftPad: number,
  rightPad: number,
  nameRow: boolean,
  beatQuarters: number,
  headRequest: HeadRequest | null,
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
  const thickness = lineGap * BEAM_THICKNESS_FACTOR;

  // **The opening, laid out before anything else, because it decides where the
  // music starts.** A clef, then the key signature, then the metre — the order
  // every printed page uses, and the order a reader's eye expects.
  const head: EngravedHead = headRequest ? { clef: null, key: [], time: null } : NO_HEAD;
  let headX = leftPad;
  if (headRequest) {
    if (headRequest.clef) {
      head.clef = {
        x: headX,
        // Each clef names one line, and sits on it: G curls around the G line,
        // F's dots straddle the F line, C is centred on the middle line.
        y: -CLEF_LINE[headRequest.clef] * lineGap,
      };
      headX += lineGap * CLEF_WIDTH;
    }
    for (const accidental of headRequest.key) {
      const step = stepOf(accidental.pitch);
      if (step === null) {
        continue;
      }
      head.key.push({
        x: headX,
        y: -(step - middleStep) * halfGap,
        kind: accidental.kind,
      });
      headX += lineGap * KEY_ACCIDENTAL_WIDTH;
    }
    if (headRequest.time) {
      head.time = { x: headX, ...headRequest.time };
      headX += lineGap * TIME_WIDTH;
    }
    if (headX > leftPad) {
      headX += lineGap * HEAD_GAP;
    }
  }

  const room = extraRoom(notes, lineGap);
  let x = headX + room[0];
  // Where each bar starts and stops on this system. Tracked as the loop walks
  // because only the loop knows which item belongs to which bar.
  const measureSpans: MeasureSpan[] = [];
  let spanFrom = headX - noteGap / 2;
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
      x += noteGap + (room[index + 1] ?? 0);
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
      x += noteGap + (room[index + 1] ?? 0);
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
    const accidental = accidentalOf(note.pitch);
    const y = -(step - middleStep) * halfGap;
    const stemUp = y > 0;
    // Everything a quarter or shorter has a black notehead.
    const filled = note.value !== 'whole' && note.value !== 'half';

    engravedNotes.push({
      x,
      y,
      value: note.value,
      filled,
      stemUp,
      accidental,
      // **The glyph's left edge**, because that is where text is drawn from,
      // and placed by the width of the accidental actually being drawn rather
      // than by one constant standing in for all five.
      accidentalX:
        x -
        lineGap *
          (HEAD_HALF + ACCIDENTAL_GAP + (accidental ? ACCIDENTAL_WIDTHS[accidental] : 0)),
      name: displayName(note.pitch),
      dots: note.dots ?? 0,
      // Cleared below for any note a beam picks up.
      flags: TAILS[note.value],
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

    x += noteGap + (room[index + 1] ?? 0);
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
      // **The note furthest from the middle line decides, not the first one.**
      // A group takes one direction for all its stems, and taking it from
      // whichever note happens to come first points the beam the wrong way
      // whenever the run moves across the staff — the fixture study's closing
      // group, C5 down to G#4, opened on the one note above the middle line
      // and hung its beam below the staff with four long stems reaching down
      // to it. Engraving's rule is the extreme note, and ties go down.
      const middle = staffLines[2];
      const furthest = group.reduce((a, b) =>
        Math.abs(b.y - middle) > Math.abs(a.y - middle) ? b : a,
      );
      const stemUp = furthest.y > middle;
      // All stems in a beamed group point the same way and reach the same
      // line — the extreme note decides, and the rest are lengthened to meet.
      // Two beams need more stem than one, or the inner beam lands on the
      // notehead of the shortest-stemmed note in the run. Lengthened by
      // exactly the depth of the stack, so the **innermost** beam ends up
      // where a single beam would have been and a run of sixteenths is not
      // drawn with visibly longer stems than the eighths beside it.
      const extra = (Math.max(1, ...group.map((n) => n.flags)) - 1) * lineGap * BEAM_PITCH;
      const beamY = stemUp
        ? Math.min(...group.map((n) => n.stem!.to)) - extra
        : Math.max(...group.map((n) => n.stem!.to)) + extra;
      for (const n of group) {
        n.stemUp = stemUp;
        n.stem = {
          x: stemUp ? n.x + lineGap * 0.62 : n.x - lineGap * 0.62,
          from: n.y,
          to: beamY,
        };
      }
      // How many beams each note wants. Read before the flags are cleared,
      // because the flag count *is* the beam count for that note.
      const tails = group.map((n) => Math.max(1, n.flags));
      const deepest = Math.max(...tails);

      // **A beamed note has no flags.** Flags are set on every note as it is
      // engraved, because most notes are not beamed and a lone eighth without
      // one is drawn as a quarter. A beam replaces them.
      for (const n of group) {
        n.flags = 0;
      }

      const stemX = group.map((n) => n.stem!.x);
      const levelY = (level: number) =>
        beamY +
        (stemUp ? 1 : -1) * (thickness / 2 + (level - 1) * lineGap * BEAM_PITCH);

      // Level 1 spans the whole group; every level above it spans only the
      // notes that carry it, in maximal runs, with a stub where a note carries
      // a level alone.
      beams.push({
        level: 1,
        from: stemX[0],
        to: stemX[stemX.length - 1],
        y: levelY(1),
        stemUp,
      });
      for (let level = 2; level <= deepest; level += 1) {
        let start = -1;
        for (let i = 0; i <= tails.length; i += 1) {
          const carries = i < tails.length && tails[i] >= level;
          if (carries && start < 0) {
            start = i;
          } else if (!carries && start >= 0) {
            const end = i - 1;
            if (end > start) {
              beams.push({
                level,
                from: stemX[start],
                to: stemX[end],
                y: levelY(level),
                stemUp,
              });
            } else {
              // A stub, pointing back toward the note this one shares a beat
              // with — forward only when there is nothing behind it.
              const backward = start > 0;
              const neighbour = stemX[backward ? start - 1 : start + 1];
              const reach = Math.min(
                lineGap * STUB_FACTOR,
                Math.abs(neighbour - stemX[start]) * 0.45,
              );
              beams.push({
                level,
                from: backward ? stemX[start] - reach : stemX[start],
                to: backward ? stemX[start] : stemX[start] + reach,
                y: levelY(level),
                stemUp,
              });
            }
            start = -1;
          }
        }
      }
    }
    run = [];
  };

  // Walked over the *items* while counting into `engravedNotes`, because a
  // rest occupies a column and produces no notehead — so the two indices
  // stopped being the same the moment silence could be drawn. Beaming by item
  // index would have joined a beam to whichever notehead happened to sit at
  // that position, which on a part with rests in it is a different note.
  let noteAt = 0;
  // Where we are inside the current bar, in quarter notes. **Beams break at
  // the beat**, and without this they do not: the fixture study's bar of
  // sixteen sixteenths came out under one beam sixteen notes long, which is
  // not how anyone writes it and not something a reader can count. Every stem
  // in a group also reaches the same line, so one bar-long group dragged the
  // stems of the high notes down to meet the lowest note in the bar.
  //
  // Reset by `barBefore`, so a bar whose notes this build cannot draw — a
  // triplet, say, dropped by `fromScore` — groups its survivors from a
  // position that is short by whatever was left out. That is a beam in a
  // slightly wrong place on a bar already labelled incomplete, not a wrong
  // rhythm, and it is the price of not carrying durations for notes there is
  // no glyph for.
  let atBeat = 0;
  notes.forEach((item) => {
    if (item.barBefore) {
      atBeat = 0;
    }
    if (!isNote(item)) {
      // **A rest breaks a beam**, which is engraving and not an accident of
      // this loop: a beam over a silence would group notes that are not a
      // group. A multi-bar rest breaks it for the same reason, twenty times
      // over.
      flush();
      // It still takes time, and the beat clock has to keep it — a bar of
      // "rest, then four sixteenths" groups from the wrong place otherwise.
      // A multi-bar rest ends its bar, so the clock restarts at the next
      // `barBefore` regardless.
      if (isRest(item)) {
        atBeat += QUARTERS[item.rest];
      }
      return;
    }
    const index = noteAt;
    noteAt += 1;
    // A group may not straddle a beat. Checked on the note's *start*, so a
    // dotted eighth ending at 0.75 keeps its sixteenth and the next beat opens
    // a new group — which is exactly how a dotted-eighth pair is printed.
    const onABeat = Math.abs(atBeat / beatQuarters - Math.round(atBeat / beatQuarters)) < 1e-9;
    if (onABeat && atBeat > 0) {
      flush();
    }
    atBeat += QUARTERS[item.value] * (item.dots ? 1.5 : 1);
    // **Anything with a tail beams, not eighths alone.** This read
    // `value === 'eighth'`, which was the whole of what the engraver could
    // draw at the time — so when sixteenths arrived they were never grouped,
    // and two of them side by side came out as two separately flagged notes
    // where a page prints one double beam.
    const beamable = TAILS[item.value] > 0;
    if (beamable && !(item.barBefore && run.length > 0)) {
      run.push(index);
      return;
    }
    flush();
    if (beamable) {
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
      head,
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
    head: {
      clef: system.head.clef ? { ...system.head.clef, y: system.head.clef.y + dy } : null,
      key: system.head.key.map((a) => ({ ...a, y: a.y + dy })),
      time: system.head.time,
    },
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
  const beatQuarters = options.beatQuarters ?? DEFAULTS.beatQuarters;

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
    // The accidentals' room is spent before the columns are, or justification
    // would hand out width that is already taken and the system would run past
    // its own right margin.
    const reserved = extraRoom(run, lineGap).reduce((a, b) => a + b, 0);
    // The clef and key signature take their room out of the same width, and
    // they take it from **every** system — the metre only from the first, which
    // is why this is computed per run rather than once.
    const headRequest: HeadRequest | null = options.head
      ? {
          clef: options.head.clef,
          key: options.head.key,
          time: systems.length === 0 ? options.head.time : null,
        }
      : null;
    const headWidth = headRoom(headRequest, lineGap);
    const stretched =
      options.justify && options.maxWidth && run.length > 1
        ? Math.min(
            (options.maxWidth - leftPad - rightPad - reserved - headWidth) /
              (run.length - 0.5),
            noteGap * MAX_JUSTIFY_STRETCH,
          )
        : noteGap;
    const laid = layoutSystem(
      run,
      clef,
      lineGap,
      stretched,
      leftPad,
      rightPad,
      nameRow,
      beatQuarters,
      headRequest,
    );
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
  //
  // **The last system is the exception, and it did not used to be.** The
  // paragraph above was written when nothing drew a final barline: a staff
  // stopping short read as a rendering failure, so ruling it to the margin was
  // the better of two bad options. Now the piece ends in a thin-and-thick bar,
  // and a double bar with empty staff ruled past it reads worse than either —
  // it says the music stopped and then the paper kept going, which is what
  // manuscript paper does and what printed music never does. So the last
  // system ends where its music does. The premise changed, not the taste.
  const flush = options.maxWidth
    ? systems.map((system, index) => ({
        ...system,
        width: index === systems.length - 1 ? system.width : width,
      }))
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
