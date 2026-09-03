import type { Articulation, Clef } from '../../data/types';
import {
  keyChangeGlyphs,
  keySignatureFor,
  type KeyAccidental,
  type KeyChangeGlyph,
} from './keySignature';

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
export type NoteValue =
  | 'breve'
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | 'sixteenth'
  | 'thirty_second'
  | 'sixty_fourth';

/**
 * How long each value lasts, in quarter notes.
 *
 * Only beam grouping needs this — the engraver otherwise measures in columns,
 * not in time. Kept here beside `TAILS` so a value added to `NoteValue` has to
 * answer both questions at once.
 */
export const QUARTERS: Record<NoteValue, number> = {
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  thirty_second: 0.125,
  sixty_fourth: 0.0625,
};

/** How many beams or flags a value carries. Whole, half and quarter carry none. */
export const TAILS: Record<NoteValue, number> = {
  breve: 0,
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  sixteenth: 2,
  thirty_second: 3,
  sixty_fourth: 4,
};

/**
 * A note or rest's membership of a tuplet.
 *
 * **A triplet eighth is an eighth notehead that lasts a third of a beat**, and
 * the only thing on the page saying so is the bracket with a 3 over it. Draw
 * the notehead without the bracket and you have printed three eighths where
 * the page has three triplet-eighths — a bar half again as long as it is, in
 * the same ink as the bars that are right. That is why `fromScore` dropped
 * every tuplet rather than drawing one, and why drawing them needs the bracket
 * and not just the notehead.
 */
export interface Tuplet {
  /** 3 for a triplet, 5 for a quintuplet, 7 for a septuplet. */
  count: number;
  /** True on the first item of the group, so the engraver can bracket it. */
  starts: boolean;
}

export interface StaveNote {
  /** Scientific pitch, e.g. `D4`, `F#4`. Flats are not drawn — see `Accidental`. */
  pitch: string;
  value: NoteValue;
  /**
   * How long this note really lasts, in quarter notes.
   *
   * Normally derivable from `value` and `dots`, and omitted when it is. A
   * **tuplet** is the case where it is not: a triplet eighth is drawn as an
   * eighth and lasts a third of a beat, not half of one. Beam grouping counts
   * in real time, so without this a triplet would break its own beam in the
   * middle and every group after it in the bar would be placed from the wrong
   * position.
   */
  quarters?: number;
  tuplet?: Tuplet;
  /**
   * A dynamic printed at this note — `mf`, `sfz`, and the rest.
   *
   * **Read from the page since Batch 2 and drawn by nothing until now.**
   * `musicxml.py` pulls it out of an imported file, `ScoreNote.dynamics`
   * carries it, the app's own type declares it, and the engraving dropped it —
   * so a piece imported from MuseScore lost every marking it had, on the
   * screen that offers itself as "the notes read from the page".
   */
  dynamic?: string;
  /** Augmentation dots, 0, 1 or 2. A dotted quarter is `quarter` with `dots: 1`. */
  dots?: number;
  /**
   * The page holds this note beyond its written value.
   *
   * **The one duration a page deliberately does not state**, which is why the
   * analysis refuses to time the note after it — `classification.Delta.timed`
   * is false for it — and why leaving this undrawn was worse than leaving a
   * dynamic undrawn. A musician reading a verdict saw a note the app declined
   * to judge, above a stave that gave no reason, because the mark that *is*
   * the reason was not on it.
   */
  fermata?: boolean;
  /** Starts a new bar before this note. */
  barBefore?: boolean;
  /**
   * The barline before this item carries repeat dots.
   *
   * Both can be true at once: a section that ends where the next one begins is
   * printed `:||:`, one barline with dots on either side. Set by `fromScore`
   * from `ScoreJson.repeats`.
   */
  repeatStartsBefore?: boolean;
  repeatEndsBefore?: boolean;
  /**
   * Which bar of the score this came from, when the caller knows.
   *
   * Only so a playhead can say where it is. The warmup, which authors its own
   * notes, has no measure numbers to give and omits it.
   */
  measureNumber?: number;
  /** The key changes at this bar. See `KeyChange`. */
  keyChange?: KeyChange;
  /**
   * The clef printed at this item, when the page changes clef here.
   *
   * Absent everywhere else, and **never the clef the piece opens in** — that
   * is the `clef` argument, and duplicating it here would draw a redundant
   * clef at the first note. The same shape as `keyChange`, for the same
   * reason: a clef is printed once and holds until another is printed.
   *
   * A cello or bass part moving into tenor for a high passage is ordinary
   * writing. Without this the whole run is placed against the opening clef, so
   * every notehead after the change sits a third or a sixth off — drawn
   * confidently, at a pitch the page does not print.
   */
  clefChange?: Clef;
  /**
   * The other pitches sounding with this one, from `ScoreNote.chord_pitches`.
   *
   * A double stop, or a chord. They share the principal's onset and value —
   * that is what makes them chord members rather than notes — so only the
   * pitches differ, and the timeline counts the group once.
   */
  chord?: string[];
  /**
   * Which slur covers this note, if any.
   *
   * **An id, not a start/end pair.** A slur is drawn as one arc per run of
   * consecutive notes carrying the same id, which means a slur broken by a
   * system break becomes two arcs with no special case — exactly what an
   * engraver draws. `fromScore` assigns the ids; `ScoreSlur` carries no nesting
   * number, so overlapping slurs cannot be expressed by the data and are not
   * expressible here either.
   */
  slur?: number;
  /**
   * This note continues a tie from the one before it — no new attack.
   *
   * From `readTies`, which is the app's mirror of the backend's tie reading:
   * one pitch to itself, across barlines, and never a slur. `scheduleScore`
   * has folded these into one long note since it was written, so the page has
   * been drawing **two separate noteheads with nothing joining them** for a
   * sound the app plays as one — which a musician reads as two attacks. That
   * is a wrong rhythm printed as a right one.
   */
  tiedFromPrevious?: boolean;
  /** A tie leaves this note. Needed for the half-curve at a line break. */
  tiesToNext?: boolean;
  /**
   * A staccato dot, a tenuto line or an accent, from `ScoreNote.articulation`.
   *
   * Read off the page since Batch 2 and drawn nowhere. A staccato dot is not
   * decoration — it changes what you play — and on a page that shows the notes
   * without it, a musician practising from the app plays the passage wrong and
   * the analysis has no way to know.
   */
  articulation?: Articulation;
  /**
   * The chord's members with their accidentals decided, set by
   * `spellAccidentals` alongside `printed`.
   *
   * Separate from `chord` for the same reason `printed` is separate from the
   * pitch name: absent means nobody spelled them, and `null` inside means
   * "print nothing", which is a real answer.
   */
  chordPrinted?: { pitch: string; accidental: Accidental }[];
  /**
   * The accidental to actually print, decided against the key signature and
   * the bar so far.
   *
   * Set by `spellAccidentals`, which `engrave` runs over every note before
   * laying anything out. `null` is a real answer — "print nothing" — and is
   * different from absent, which means nobody has spelled this note and the
   * accidental in its own name should be drawn.
   */
  printed?: Accidental;
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
/**
 * The key changes at this item's bar.
 *
 * **Carried on the first item of the bar, as a name.** `ScoreMeasure.key_signature`
 * holds the change where the page prints it; `staveScoreFor` moves it onto the
 * first thing drawn in that bar, and the engraver — which is the only thing
 * here that knows the clef — turns the name into positions. Named rather than
 * positioned so the same item is right on every clef.
 *
 * Until this existed a piece that turned from B-flat to G at bar 7 was
 * engraved with two flats on every system to the end and an inline sharp on
 * every F after the change: a page that says one thing in the signature and
 * another in the notes, which no printed part does.
 */
export interface KeyChange {
  /** The new key as printed — `G major`, `E minor`. */
  key: string | null;
}

export interface StaveRest {
  rest: NoteValue;
  /** Augmentation dots, 0, 1 or 2. */
  dots?: number;
  /** As on `StaveNote` — a rest inside a tuplet is part of the group. */
  quarters?: number;
  tuplet?: Tuplet;
  barBefore?: boolean;
  repeatStartsBefore?: boolean;
  repeatEndsBefore?: boolean;
  measureNumber?: number;
  /** The key changes at this bar. See `KeyChange`. */
  keyChange?: KeyChange;
  /**
   * The clef printed at this item, when the page changes clef here.
   *
   * Absent everywhere else, and **never the clef the piece opens in** — that
   * is the `clef` argument, and duplicating it here would draw a redundant
   * clef at the first note. The same shape as `keyChange`, for the same
   * reason: a clef is printed once and holds until another is printed.
   *
   * A cello or bass part moving into tenor for a high passage is ordinary
   * writing. Without this the whole run is placed against the opening clef, so
   * every notehead after the change sits a third or a sixth off — drawn
   * confidently, at a pitch the page does not print.
   */
  clefChange?: Clef;
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
  repeatStartsBefore?: boolean;
  repeatEndsBefore?: boolean;
  measureNumber?: number;
  /** The key changes at this bar. See `KeyChange`. */
  keyChange?: KeyChange;
  /**
   * The clef printed at this item, when the page changes clef here.
   *
   * Absent everywhere else, and **never the clef the piece opens in** — that
   * is the `clef` argument, and duplicating it here would draw a redundant
   * clef at the first note. The same shape as `keyChange`, for the same
   * reason: a clef is printed once and holds until another is printed.
   *
   * A cello or bass part moving into tenor for a high passage is ordinary
   * writing. Without this the whole run is placed against the opening clef, so
   * every notehead after the change sits a third or a sixth off — drawn
   * confidently, at a pitch the page does not print.
   */
  clefChange?: Clef;
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

/**
 * How wide each articulation is, in staff spaces — Bravura's own advances.
 *
 * A staccato dot is a third of a space and an accent is one and a third, so one
 * constant standing in for all three centres two of them wrong.
 */
export const ARTICULATION_WIDTHS: Record<Articulation, number> = {
  staccato: 0.336,
  tenuto: 1.352,
  accent: 1.356,
};

/**
 * How far each articulation reaches from its own origin, in staff spaces.
 *
 * Bravura's glyph bounds, read out of the font. **The "above" glyphs sit
 * entirely above their origin and the "below" ones entirely below it**, so the
 * placement needs no adjustment — but the system's height does, and so does a
 * slur passing over them.
 *
 * Without this an accent above a high note was drawn 0.98 spaces past the top
 * of the box measured for the system, and the tip was clipped off by the SVG
 * viewport. Measured, not estimated: an accent is five times a tenuto's reach
 * and three times a staccato dot's.
 */
export const ARTICULATION_HEIGHTS: Record<Articulation, number> = {
  staccato: 0.34,
  tenuto: 0.19,
  accent: 0.98,
};

/**
 * How far from the notehead's centre an articulation sits, in staff spaces.
 *
 * Outside the notehead and inside anything else. It goes on the side away from
 * the stem, which is where a reader looks for it and where there is room.
 */
const ARTICULATION_CLEARANCE = 1.05;

/**
 * Bravura's `fermataAbove` (U+E4C0), in staff spaces: its advance, and how far
 * it rises above its own baseline.
 *
 * Measured out of the font with `fontTools`, like the dynamics' ink boxes and
 * the flag overshoots. It reaches essentially nothing below the baseline
 * (0.012 spaces), so the baseline is where the mark stops.
 */
const FERMATA_WIDTH = 2.42;
const FERMATA_HEIGHT = 1.32;

/**
 * The white between a fermata and whatever it sits over, in staff spaces.
 *
 * Wider than `ARTICULATION_CLEARANCE`, and deliberately: an articulation is
 * part of the note and hugs it, while a fermata belongs to the bar and reads
 * as a sign over the music rather than a mark on one notehead.
 */
const FERMATA_CLEARANCE = 0.9;

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
  /**
   * The articulation to draw, with the position it is drawn at.
   *
   * `above` picks between the two glyphs, which are not mirror images of one
   * another in Bravura and must not be flipped in the renderer.
   */
  articulation: { kind: Articulation; x: number; y: number; above: boolean } | null;
  /** Where a fermata over this note goes: the glyph's left edge and baseline. */
  fermata: { x: number; y: number } | null;
  /** Y positions of ledger lines this note needs, above or below the staff. */
  ledgers: number[];
  /**
   * The rest of the chord: one entry per additional notehead, at its own
   * staff position.
   *
   * `x` is absolute rather than an offset because a head a **second** away
   * from its neighbour cannot share the column — two noteheads a step apart
   * overlap into an unreadable blob — so it is pushed to the far side of the
   * stem. That is not a refinement; it is the difference between a chord and a
   * smudge.
   */
  chord: { x: number; y: number; accidental: Accidental; accidentalX: number }[];
  /** The note's letter and accidental, for the row under the system. */
  name: string;
  /**
   * Augmentation dots printed after the notehead. 0, 1 or 2.
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
  /**
   * Augmentation dots, 0, 1 or 2. Same mark, same meaning, same reason as a note's.
   *
   * A dotted quarter rest was the **last** thing in the whole corpus with no
   * glyph, and it was undrawable only because nothing had put the dot after a
   * rest — the glyph and the note's placement rule already existed.
   */
  dots: number;
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
/**
 * A barline, and whether it carries repeat dots.
 *
 * **This was a bare `number[]`**, and the app played repeats it never drew:
 * `scheduleScore` runs `measuresInPlayOrder`, which expands them, so Listen
 * played bars 1–8 twice over a page showing one straight run of eight with no
 * `:||` anywhere. A musician following the app's own score got lost at bar 8.
 *
 * `both` is a real value rather than a convenience: a section ending where the
 * next one begins is one barline printed with dots on either side.
 */
export interface EngravedBarline {
  x: number;
  repeat: 'start' | 'end' | 'both' | null;
}

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

/** How far a tuplet bracket clears the furthest thing under it, in staff spaces. */
const TUPLET_CLEARANCE = 1.2;
/** How far the bracket's end hooks drop towards the notes. */
const TUPLET_HOOK = 0.7;
/** Room above and below a bracket for its numeral. */
const TUPLET_NUMBER_ROOM = 1.4;

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
/**
 * A clef printed mid-piece, in staff spaces, and the gap before it.
 *
 * Narrower than the head's `CLEF_WIDTH` because an engraver draws a change of
 * clef smaller than the one that opens a system — it is a correction to the
 * reader, not the start of a new line — and `CLEF_CHANGE_SCALE` is that size.
 */
const CLEF_CHANGE_WIDTH = 2.6;
const CLEF_CHANGE_GAP = 0.4;
/** How much of full size a mid-piece clef is drawn at. */
export const CLEF_CHANGE_SCALE = 0.78;
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
  /**
   * The clef this system opens with, and which one it is.
   *
   * **The glyph travels with the position.** Once a piece can change clef, the
   * system's own clef is not the piece's, and a renderer reaching for the
   * caller's `clef` prop draws the opening clef at the new clef's line — the
   * old sign on the new staff position, which is worse than either.
   */
  clef: { x: number; y: number; clef: Clef } | null;
  /** Key accidentals in printing order, each centred on its own `y`. */
  key: { x: number; y: number; kind: 'sharp' | 'flat' }[];
  /**
   * The metre, on the first system only — which is where a page prints it, and
   * repeating it every line would read as a metre change.
   */
  time: { x: number; beats: number; unit: number } | null;
}

/**
 * A tuplet bracket: the line over (or under) the group and its numeral.
 *
 * The bracket is what makes three eighths a triplet, so it is not decoration —
 * it is the only mark on the page that states the ratio. Drawn on the stem
 * side, which is where an engraver puts it, and broken in the middle for the
 * number.
 */
/**
 * A slur, as a quadratic curve the renderer can draw without arithmetic.
 *
 * **Bowing, on a page for string players.** A Kreutzer étude without its slurs
 * is a page you cannot bow, and the app has been keeping `measure.slurs`
 * correct through every edit (`spans.ts`) while drawing none of them.
 *
 * It arcs away from the stems — an engraver puts a slur on the notehead side —
 * and springs from just outside the outer noteheads rather than from their
 * centres, so it reads as touching the notes rather than crossing them.
 */
export interface EngravedSlur {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** The single control point of a quadratic Bézier. */
  control: { x: number; y: number };
}

/**
 * A first- or second-time ending bracket.
 *
 * **The other half of a repeat.** The repeat signs went in without these, which
 * told a musician to go back and said nothing about playing a different bar the
 * second time — half an instruction. `measuresInPlayOrder` has taken the
 * endings since it was written, so the app *played* the right notes over a page
 * that could not explain them.
 *
 * Closed at the right for a first ending, because the repeat sends you back
 * from there; open for the last one, because you carry on. That difference is
 * the whole reading of the bracket and is not decoration.
 */
export interface EngravedEnding {
  from: number;
  to: number;
  y: number;
  /** Where the number's baseline sits, already offset from `y`. */
  labelY: number;
  /** The number's font size. */
  labelSize: number;
  /** How far the end hooks drop. Positive is down the page. */
  hook: number;
  /** "1." or "2." — printed at the left, inside the bracket. */
  label: string;
  /** Whether the right end hooks down, or runs on. */
  closesRight: boolean;
}

export interface EngravedTuplet {
  from: number;
  to: number;
  /** The bracket's line. The hooks drop from it towards the notes. */
  y: number;
  /** Down from `y` for a bracket above the notes, up for one below. */
  hook: number;
  /** Where the numeral's centre sits, in the gap left for it. */
  numberX: number;
  count: number;
}

export interface EngravedSystem {
  /** Y of each of the five staff lines, top first. Absolute in the drawing. */
  staffLines: number[];
  /** X of each barline, including the one that ends the system. */
  barlines: EngravedBarline[];
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
  tuplets: EngravedTuplet[];
  slurs: EngravedSlur[];
  /**
   * Ties, in the same shape as slurs and deliberately in their own array.
   *
   * They are drawn the same way and they mean different things: a slur is a
   * phrase mark over any notes, a tie joins one pitch to itself and removes an
   * attack. Keeping them apart means a change to how slurs are placed cannot
   * quietly move ties.
   */
  ties: EngravedSlur[];
  endings: EngravedEnding[];
  /**
   * Dynamics, on one baseline for the whole system.
   *
   * A printed part lines them up rather than following each note's own depth —
   * a row of marks at different heights reads as noise, and the eye uses the
   * line itself to find them.
   */
  dynamics: EngravedDynamic[];
  /** Clef, key and metre at the left edge. Empty when none was asked for. */
  head: EngravedHead;
  /**
   * Key changes printed mid-line, just after the barline of the bar they open.
   *
   * A change on the first bar of a system is not here: the head already opens
   * that system in the new key, and printing it twice would read as two
   * changes.
   */
  keyChanges: EngravedKeyChange[];
  /**
   * Clefs printed mid-system, at the bar each takes effect.
   *
   * A change on the first item of a system is not here: the head already opens
   * that system in the new clef, and drawing it twice reads as two changes —
   * the same rule `keyChanges` follows.
   */
  clefChanges: EngravedClefChange[];
  /** Baseline for the note names printed under this system. */
  nameY: number;
  /** Right edge of this system's staff lines. */
  width: number;
  /**
   * The top and bottom of everything this system draws, absolute in the
   * drawing — ink, not staff lines.
   *
   * The engraver already measures both to stack the systems (`laid.top`,
   * `laid.bottom`); it simply used to throw them away afterwards. A caller
   * that wants to break the drawing into pages needs the true extent: a
   * system's staff lines say nothing about the stem reaching two spaces above
   * them, so a page break placed from `staffLines` cuts ink off at the fold.
   */
  top: number;
  bottom: number;
}

/** One dynamic marking, already composed into the glyphs that spell it. */
export interface EngravedDynamic {
  /** Centre of the notehead it belongs to. */
  x: number;
  /** The shared baseline. */
  y: number;
  /** The letters, as Bravura codepoints — `mf` is two glyphs, `sfz` three. */
  glyphs: string;
  /** Advance width, so the renderer can centre it without measuring text. */
  width: number;
}

/**
 * A clef printed part-way through, at the bar it takes effect.
 *
 * `y` is the staff line the clef names, exactly as the head's is — a clef is
 * the same drawing wherever it appears, only smaller here.
 */
export interface EngravedClefChange {
  x: number;
  y: number;
  clef: Clef;
}

/** One glyph of a key change, centred on its own staff position like the head's. */
export interface EngravedKeyChange {
  x: number;
  y: number;
  kind: 'sharp' | 'flat' | 'natural';
}

export interface Engraving {
  width: number;
  height: number;
  systems: EngravedSystem[];
}

export interface EngraveOptions {
  /**
   * First- and second-time endings, by measure number.
   *
   * Given to the engraving whole rather than marked on items, because a bracket
   * spans *measures* and `measureSpans` already knows where each one starts and
   * stops on each system — which is also what makes a bracket split by a line
   * break come out right without any special case.
   */
  endings?: { label: string; from: number; to: number; closed: boolean }[];
  /**
   * The score's very last barline ends a repeated section.
   *
   * Every other repeat sign is carried by the item after it (`repeatEndsBefore`).
   * A repeat closing on the final measure has no such item, so it is the one
   * that has to be passed in. `staveScoreFor` computes it.
   */
  closesWithRepeat?: boolean;
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
 * The narrowest a column may be, in staff spaces.
 *
 * A notehead is 1.18 spaces wide, so anything under that prints one note
 * through the next. Set just above it: this is a floor for music that does not
 * fit, not a spacing preference.
 *
 * **It is half a mechanism.** Reaching it means the system now wants more
 * width than it was given, and the engraver cannot fix that — it breaks only
 * at barlines and the bar that hit the floor is a single bar. The component's
 * `fitWidth` is the other half: it shrinks the whole engraving until the
 * widest system fits, so the notes get smaller rather than closer. Without the
 * floor the layout has no way to *say* it needs more room — it silently
 * spends the shortfall on the gaps, and 16 sixteenths came out at 0.95 spaces
 * a column with the noteheads printing into each other, inside a system of
 * exactly the right width.
 */
const MIN_COLUMN = 1.4;

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
 * A whole notehead's width, in staff spaces — twice `HEAD_HALF`.
 *
 * How far a chord member a **second** from its neighbour is pushed sideways, so
 * the two heads sit beside each other across the stem instead of on top of one
 * another.
 */
const HEAD_WIDTH = HEAD_HALF * 2;

/**
 * How far apart stacked chord accidentals sit, in staff spaces.
 *
 * A column per head. Wide enough for the widest glyph (a double flat is 1.65)
 * plus air, because the alternative is measuring what each column actually
 * holds — which an engraver does and which would be a second layout pass for a
 * case that is two or three noteheads.
 */
const ACCIDENTAL_COLUMN = 1.9;

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
/**
 * Every accidental this note prints, in the column order they are stacked in.
 *
 * **Columns are counted among the heads that actually print something**, not
 * among all of them. Indexing by chord position pushed a lone flat on the
 * second member two columns out — far enough to land on the previous note — and
 * the room reserved for it, computed the same wrong way, did not cover it
 * either. One rule, used by the layout and by `extraRoom`, so they cannot
 * disagree about where the glyphs go.
 *
 * Top of the chord first, which is the order an engraver reads them in.
 */
function accidentalStack(
  note: StaveNote,
): { pitch: string; accidental: NonNullable<Accidental> }[] {
  const heads: { pitch: string; accidental: Accidental }[] = [
    { pitch: note.pitch, accidental: printedAccidental(note) },
    ...(note.chordPrinted ??
      (note.chord ?? []).map((pitch) => ({ pitch, accidental: accidentalOf(pitch) }))),
  ];
  return heads
    .filter(
      (head): head is { pitch: string; accidental: NonNullable<Accidental> } =>
        head.accidental !== null && stepOf(head.pitch) !== null,
    )
    .sort((a, b) => (stepOf(b.pitch) as number) - (stepOf(a.pitch) as number));
}

/** Whether any two of this note's heads are one staff position apart. */
function hasSecond(note: StaveNote): boolean {
  const steps = [note.pitch, ...(note.chord ?? [])]
    .map(stepOf)
    .filter((step): step is number => step !== null)
    .sort((a, b) => a - b);
  return steps.some((step, i) => i > 0 && step - steps[i - 1] === 1);
}

/**
 * The horizontal room one item needs to the left of its column.
 *
 * The whole accidental stack measured as it will actually be drawn, plus a
 * notehead's width when a head has to move across the stem.
 */
function noteRoom(note: StaveNote): number {
  const stack = accidentalStack(note);
  const widest = stack.reduce(
    (most, head) => Math.max(most, ACCIDENTAL_WIDTHS[head.accidental]),
    0,
  );
  const columns =
    stack.length === 0
      ? 0
      : HEAD_HALF + ACCIDENTAL_GAP * 2 + widest + ACCIDENTAL_COLUMN * (stack.length - 1);
  return columns + (hasSecond(note) ? HEAD_WIDTH : 0);
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

/**
 * The gap between two neighbouring dynamics, in staff spaces.
 *
 * Only ever between two of them — vertical clearance is what keeps a mark off
 * the notes. `mf` and `sfz` on adjacent quarters printed as `mfsfz`, one word,
 * which is what this is for.
 */
const DYNAMIC_GAP = 0.6;

/**
 * How far an item's dynamic reaches either side of its notehead, in staff
 * spaces, or null when it carries none.
 *
 * The mark is drawn centred on the note, so the pen starts half an advance to
 * the left and the ink runs from there. Reaching from the *ink* rather than
 * the advance matters: `f` overhangs its pen by 0.56 spaces on the left.
 */
function dynamicReach(
  item: StaveItem | undefined,
): { left: number; right: number } | null {
  if (!item || !isNote(item) || !item.dynamic) {
    return null;
  }
  const spelled = spellDynamic(item.dynamic, 1);
  return spelled
    ? {
        left: spelled.width / 2 - spelled.left,
        right: spelled.right - spelled.width / 2,
      }
    : null;
}

/**
 * A key change with its positions decided: the signature now in force, and
 * what is printed at the barline to announce it.
 */
export interface ResolvedKeyChange {
  key: KeyAccidental[];
  printed: KeyChangeGlyph[];
}

/**
 * Every item's key change, positioned for this clef, or null.
 *
 * Walked once over the whole piece rather than per system, because what a
 * change *prints* depends on the key it changes from — a change to C major is
 * two naturals after B-flat and three after A — and the key it changes from
 * may have been set on an earlier line.
 */
export function resolveKeyChanges(
  items: StaveItem[],
  head: KeyAccidental[],
  clef: Clef,
): (ResolvedKeyChange | null)[] {
  let running = head;
  return items.map((item) => {
    if (!item.keyChange) {
      return null;
    }
    const next = keySignatureFor(item.keyChange.key, clef);
    const resolved = { key: next, printed: keyChangeGlyphs(running, next) };
    running = next;
    return resolved;
  });
}

/** Clearance between the barline and the first glyph of a key change, in staff spaces. */
const KEY_CHANGE_GAP = 0.6;

/** The width a key change printed at a barline takes, in staff spaces. */
function keyChangeWidth(change: ResolvedKeyChange | null | undefined): number {
  if (!change || change.printed.length === 0) {
    return 0;
  }
  return KEY_CHANGE_GAP + change.printed.length * KEY_ACCIDENTAL_WIDTH;
}

/** The room each item needs before it, beyond the ordinary column. */
function extraRoom(
  items: StaveItem[],
  lineGap: number,
  keyChanges: (ResolvedKeyChange | null)[] = [],
): number[] {
  return items.map((item, index) =>
    // The **printed** glyph, not the one in the pitch name. Reserving room from
    // the name gives a suppressed sharp a column it never uses and gives a
    // printed natural — which no pitch name ever carries — no room at all, so
    // it would sit through the notehead before it.
    //
    // A chord asks for its whole stack: one column per member that prints an
    // accidental, plus a notehead's width when a member sits a second away and
    // has to move across the stem. Reserving only the principal's would put a
    // three-accidental chord through the note before it.
    lineGap *
      ((isNote(item) ? noteRoom(item) : 0) +
        repeatRoom(item) +
        tieRoom(item) +
        // A key change printed at the barline sits between it and the note.
        // A clef printed here needs its own room, the same as a key does.
        (item.clefChange ? CLEF_CHANGE_GAP + CLEF_CHANGE_WIDTH : 0) +
        keyChangeWidth(keyChanges[index]) +
        // Two marks in a row need the room between their centres that their
        // own halves take up. Nothing is reserved when either side is
        // unmarked, so an isolated `p` does not widen the music around it.
        (() => {
          const previous = dynamicReach(items[index - 1]);
          const here = dynamicReach(item);
          return previous && here
            ? previous.right + here.left + DYNAMIC_GAP
            : 0;
        })()),
  );
}

/**
 * The extra width a repeat sign asks for, in staff spaces.
 *
 * **A repeat barline is wider than a plain one and needs to be given room.**
 * Without this the opening sign's lower dot printed hard against the notehead
 * of the bar it opens — the two are at the same height whenever that note sits
 * in the third space, which on a treble staff is a C5 and on a bass staff a
 * D3, neither of them rare. Measured at the score screen's own scale: 2.3px of
 * clearance, which at that size reads as one smudged mark.
 *
 * Reserved *before* the marked item, which is where it has to go for both
 * signs: the barline sits midway in the gap it interrupts, so widening the gap
 * moves the barline right and opens space on its left for a closing sign as
 * well as on its right for an opening one.
 */
/**
 * Room before a note a tie arrives at, in staff spaces.
 *
 * A tie has to start somewhere left of the notehead it reaches. Mid-system it
 * borrows the ordinary note gap; **at the start of a system there is no gap to
 * borrow** — the first note sits at the left margin — and the leading half of a
 * tie broken by a line break had nowhere to go, coming out as a zero-length
 * curve on top of the notehead. Reserving it here works for both, because the
 * first item's room is spent between the head and the note.
 *
 * Sized so the leading half is long enough to read as a curve rather than as a
 * speck: `TIE_INSET` is spent before it starts, so this has to exceed it by a
 * visible margin. It widens the gap before every tied note by the same amount,
 * which is what an engraver does anyway — a tie needs somewhere to be.
 */
const TIE_ARRIVAL_ROOM = 1.7;

function tieRoom(item: StaveItem): number {
  return isNote(item) && item.tiedFromPrevious === true ? TIE_ARRIVAL_ROOM : 0;
}

function repeatRoom(item: StaveItem): number {
  const starts = item.repeatStartsBefore === true;
  const ends = item.repeatEndsBefore === true;
  if (starts && ends) {
    return REPEAT_SIGN_ROOM * 2;
  }
  return starts || ends ? REPEAT_SIGN_ROOM : 0;
}

/**
 * How much room one repeat sign takes beyond a plain barline, in staff spaces.
 *
 * The sign is a heavy rule, a thin one and two dots — about 0.95 spaces from
 * the barline's centre to the outside of the dots, and the same again on the
 * other side for `:||:`. This is that reach plus a comfortable gap, so the dots
 * never touch a notehead.
 */
const REPEAT_SIGN_ROOM = 1.4;

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

/** How many semitones a pitch name alters its letter by: -2 to +2. */
export function alterationOf(pitch: string): number {
  const match = PITCH.exec(pitch);
  if (!match || !match[2]) {
    return 0;
  }
  return { '#': 1, b: -1, '##': 2, bb: -2 }[match[2] as '#' | 'b' | '##' | 'bb'] ?? 0;
}

const GLYPH_FOR_ALTERATION: Record<number, Accidental> = {
  [-2]: 'double-flat',
  [-1]: 'flat',
  0: 'natural',
  1: 'sharp',
  2: 'double-sharp',
};

/**
 * Decide which accidentals to actually print.
 *
 * **The engraver printed one before every altered note and none anywhere else**,
 * on top of a key signature, which gets both halves of the convention wrong:
 *
 *  - A piece in D major came out with two sharps in the signature *and* a sharp
 *    on every F and every C. Legal, and it reads as a machine transcribing
 *    pitches rather than as a page of music.
 *  - Far worse, an **F natural in D major printed nothing at all**. The pitch
 *    names from OCR are absolute — MusicXML's `<alter>` already includes the
 *    key signature, so a written F natural arrives as plain `F4` — and a bare F
 *    under a two-sharp signature is read by any musician as F sharp. That is a
 *    wrong note printed as though it were right, which is the one thing this
 *    module's docstring says it must never do.
 *
 * The rule, which is a convention with no room for invention: an accidental is
 * printed only when the note differs from what is already in force. In force
 * means the key signature for that letter, in every octave, unless an earlier
 * accidental in the same bar has overridden it **at that exact staff position**
 * — an accidental binds to the octave it is written in, not to the letter.
 *
 * Bars reset it, which is why the pass is over the whole score in order rather
 * than per system. Systems break on bar lines (`packSystems`), so no bar's
 * memory ever has to cross one.
 *
 * Returns new items; nothing is mutated. Rests and multi-rests pass through
 * untouched.
 */
export function spellAccidentals(
  items: StaveItem[],
  key: { pitch: string; kind: 'sharp' | 'flat' }[] = [],
): StaveItem[] {
  // The signature, by letter. A key signature applies to every octave of the
  // letter it marks, which is why this is keyed by letter and the bar's memory
  // below is keyed by staff position.
  const lettersOf = (signature: { pitch: string; kind: 'sharp' | 'flat' }[]) => {
    const letters = new Map<number, number>();
    for (const accidental of signature) {
      const match = PITCH.exec(accidental.pitch);
      if (match) {
        letters.set(LETTERS[match[1]], accidental.kind === 'sharp' ? 1 : -1);
      }
    }
    return letters;
  };
  let byLetter = lettersOf(key);

  let bar = new Map<number, number>();
  let started = false;

  return items.map((item) => {
    if (item.barBefore || !started) {
      bar = new Map();
      started = true;
    }
    if (item.keyChange) {
      // **The signature from here on is the new one.** Letters only, so the
      // clef does not matter: a key sharpens the same letters on every staff.
      byLetter = lettersOf(keySignatureFor(item.keyChange.key, 'treble'));
    }
    if (!isNote(item)) {
      return item;
    }
    const step = stepOf(item.pitch);
    if (step === null) {
      return { ...item, printed: null };
    }
    // **The whole chord, in staff order, sharing one bar memory.** A chord is
    // one moment: an F sharp in it puts F sharp in force for the rest of the
    // bar exactly as a single note would, and its own members are spelled
    // against what the members below them already established.
    const spell = (pitch: string): Accidental => {
      const at = stepOf(pitch);
      if (at === null) {
        return null;
      }
      const alteration = alterationOf(pitch);
      const letterOf = ((at % 7) + 7) % 7;
      const holds = bar.has(at) ? (bar.get(at) as number) : (byLetter.get(letterOf) ?? 0);
      if (alteration === holds) {
        return null;
      }
      bar.set(at, alteration);
      return GLYPH_FOR_ALTERATION[alteration] ?? null;
    };

    const printed = spell(item.pitch);
    const members = item.chord ?? [];
    if (members.length === 0) {
      return { ...item, printed };
    }
    return {
      ...item,
      printed,
      chordPrinted: members.map((pitch) => ({ pitch, accidental: spell(pitch) })),
    };
  });
}

/**
 * One chord's noteheads: principal first, then the rest in staff order.
 *
 * **Sorted, because the stem and the accidental columns both depend on order.**
 * `chord_pitches` arrives in the order the importer met them in the MusicXML,
 * which is not necessarily by pitch.
 *
 * A member whose pitch cannot be placed is dropped here as well as in
 * `fromScore` — this is the last line of that defence, and a notehead put on
 * the middle line under a name it does not have is the failure the whole module
 * is written against.
 */
function chordHeads(
  note: StaveNote,
  middleStep: number,
  halfGap: number,
): { pitch: string; y: number; accidental: Accidental }[] {
  const principalStep = stepOf(note.pitch) ?? 0;
  const principal = {
    pitch: note.pitch,
    step: principalStep,
    y: -(principalStep - middleStep) * halfGap,
    accidental: printedAccidental(note),
  };

  // Spelled if something spelled them, and from their own names if not — the
  // same fallback `printedAccidental` gives the principal, for a caller that
  // builds items by hand.
  const members = note.chordPrinted
    ? note.chordPrinted
    : (note.chord ?? []).map((pitch) => ({ pitch, accidental: accidentalOf(pitch) }));

  const rest: typeof principal[] = [];
  for (const member of members) {
    const step = stepOf(member.pitch);
    if (step === null) {
      continue;
    }
    rest.push({
      pitch: member.pitch,
      step,
      y: -(step - middleStep) * halfGap,
      accidental: member.accidental,
    });
  }
  rest.sort((a, b) => a.step - b.step);
  return [principal, ...rest].map(({ pitch, y, accidental }) => ({
    pitch,
    y,
    accidental,
  }));
}

/**
 * Which noteheads have to move off the column.
 *
 * Two heads a **second** apart overlap into an unreadable blob, so an engraver
 * puts the second of the pair on the far side of the stem. Walks the chord from
 * the bottom of the staff up, displacing alternate members of each run of
 * adjacent steps — a cluster of three ends up left, right, left.
 *
 * Returns one flag per head, in the order `chordHeads` gave them.
 */
function displacedHeads(
  heads: { y: number }[],
  halfGap: number,
): boolean[] {
  const order = heads
    .map((head, index) => ({ index, y: head.y }))
    .sort((a, b) => b.y - a.y); // lowest on the staff first
  const out = heads.map(() => false);
  let previous: number | null = null;
  let displaced = false;
  for (const head of order) {
    const isSecond =
      previous !== null && Math.abs(Math.abs(head.y - previous) - halfGap) < halfGap / 100;
    displaced = isSecond && !displaced;
    out[head.index] = displaced;
    previous = head.y;
  }
  return out;
}

/**
 * What to draw before this notehead.
 *
 * The spelled answer when there is one, and the note's own accidental when
 * nothing has spelled it — so a caller that builds items by hand and lays them
 * out directly still gets its sharps.
 */
export function printedAccidental(note: StaveNote): Accidental {
  return note.printed !== undefined ? note.printed : accidentalOf(note.pitch);
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
  costs: number[],
  budget: number,
  /**
   * The room a courtesy key signature takes on the line **before** each bar,
   * indexed by bar. Zero for a bar that changes no key.
   *
   * **Reserved with one bar of lookahead, and that is the whole subtlety.** A
   * bar that changes key prints its new signature after its own barline when
   * it continues a line, and as a courtesy at the end of the *previous* line
   * when it opens one — so the room is owed by whichever line ends up in front
   * of it, which is not known until the break is chosen. Charging it to the
   * previous bar unconditionally is worse than not charging it at all: it
   * makes the line break, and the break is what creates the courtesy it was
   * paying for. So a bar is only added to a line if the line can still afford
   * the courtesy for whatever comes next.
   *
   * Conservative in one direction only: when the next bar turns out to fit
   * after all, the line is up to one signature narrower than it could have
   * been. That is the same safe direction the bar costs already round in —
   * early, never late.
   */
  courtesy: number[] = [],
): StaveItem[][] {
  const systems: StaveItem[][] = [];
  let current: StaveItem[] = [];
  let spent = 0;

  bars.forEach((bar, index) => {
    const cost = costs[index] ?? 0;
    // What this line still owes if the next bar opens a new one.
    const owed = courtesy[index + 1] ?? 0;
    if (current.length > 0 && spent + cost + owed > budget) {
      systems.push(current);
      current = [];
      spent = 0;
    }
    current = current.concat(bar);
    spent += cost;
  });
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
  /** Whether this system's closing barline ends a repeated section. */
  closesWithRepeat: boolean,
  /** Endings that may cross this system, by measure number. */
  endingSpans: NonNullable<EngraveOptions['endings']>,
  /** Each item's key change, positioned, or null. Index 0 is never drawn here. */
  keyChanges: (ResolvedKeyChange | null)[] = [],
  /**
   * The change that opens the **next** system, printed here as a courtesy
   * before the closing barline — which is where a printed part warns the
   * reader that the line they are about to start is in another key. Without
   * it a change that happens to fall at a line break is announced only by the
   * next head, and a change *to C major* is announced by nothing at all.
   */
  closingChange: ResolvedKeyChange | null = null,
): { system: PlacedSystem; top: number; bottom: number } {
  const halfGap = lineGap / 2;
  /**
   * Which line the middle of the staff names, for the clef **in force**.
   *
   * Reassigned as the run is walked: a clef printed mid-line moves every
   * notehead after it. The head's key signature is placed against the value
   * this starts at, which is right — the head opens the system in the clef the
   * system starts in, and any change is drawn later, at the item carrying it.
   */
  let middleStep = MIDDLE_LINE_STEP[clef];
  const staffLines = [-2, -1, 0, 1, 2].map((i) => i * lineGap);
  const engravedNotes: EngravedNote[] = [];
  const engravedRests: EngravedRest[] = [];
  const multiRests: EngravedMultiRest[] = [];
  const barlines: EngravedBarline[] = [];
  const beams: EngravedBeam[] = [];
  const tuplets: EngravedTuplet[] = [];
  const slurs: EngravedSlur[] = [];
  const endings: EngravedEnding[] = [];
  const ties: EngravedSlur[] = [];
  const engravedKeyChanges: EngravedKeyChange[] = [];
  const engravedClefChanges: EngravedClefChange[] = [];
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
        clef: headRequest.clef,
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

  const room = extraRoom(notes, lineGap, keyChanges);

  /**
   * How far to the next column.
   *
   * **Floored here rather than on `noteGap`**, because `noteGap` is only the
   * part of the distance that justification controls: an item that reserves
   * room gets that on top, and flooring the base would inflate every system
   * whose notes ask for room — measured, it pushed the Kreutzer study from 348
   * points wide to 405 on a 390-point screen.
   *
   * The floor exists because the division that produces `noteGap` under
   * `justify` has none of its own. It subtracts the reservations from the
   * available width and divides what is left, which goes negative as soon as a
   * system reserves more than it has — a bar of dynamics does it outright, and
   * a chromatic run on a narrow phone comes within a staff space. The columns
   * that reserve nothing then take the whole shortfall: four marked notes
   * followed by eight plain ones squeezed the plain ones to 0.56 staff spaces,
   * half a notehead, and they printed through each other.
   */
  const columnStep = (index: number) =>
    Math.max(noteGap + (room[index] ?? 0), lineGap * MIN_COLUMN);

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
    // Before anything is placed for this item: a clef printed here governs
    // this notehead too, not merely the ones after it.
    if (item.clefChange) {
      middleStep = MIDDLE_LINE_STEP[item.clefChange];
      /*
        **Right-aligned against the notehead it governs**, inside the room
        `extraRoom` reserved before this item. Anchored to the note rather than
        to the barline because a clef change does not need one — it is
        commonest at a barline and legal without it, and anchoring to something
        that may not exist is how the sign ends up somewhere else on the rare
        page. The first item of a system is excluded: the head already opens
        the line in this clef, and drawing it again reads as two changes.
      */
      if (index > 0) {
        engravedClefChanges.push({
          x: x - lineGap * CLEF_CHANGE_WIDTH,
          y: -CLEF_LINE[item.clefChange] * lineGap,
          clef: item.clefChange,
        });
      }
    }
    if (item.barBefore && index > 0) {
      // The line sits midway in the gap it interrupts, so it belongs to
      // neither of the notes on either side.
      const kind = repeatKind(item);
      /*
        **An opening sign needs its room on the right, and the barline has to
        move to give it.** `extraRoom` widens the gap *before* the item, and
        the barline sits midway in that gap — so both moved right together and
        the distance from the sign to the note it opens stayed exactly what it
        always was. Measured: the lower dot printed inside the notehead of the
        bar it opens, which on a treble staff is any C5 and on a bass staff any
        D3.

        Shifting the barline left by the room spends it on the right side,
        where an opening sign reaches. A closing sign reaches left and already
        has it. `both` reserves twice and sits in the middle of it.
      */
      const opens = kind === 'start' || kind === 'both';
      // A key change is printed **after** the barline — it belongs to the bar
      // it opens — so, like an opening repeat sign, its room is spent on the
      // right by moving the barline left.
      const change = keyChanges[index] ?? null;
      const changeRoom = lineGap * keyChangeWidth(change);
      // The clef sits between the barline and the note, so the barline clears
      // it too — without this the line is drawn through the new clef.
      const clefRoom = item.clefChange
        ? lineGap * (CLEF_CHANGE_GAP + CLEF_CHANGE_WIDTH)
        : 0;
      const barlineX =
        x -
        noteGap / 2 -
        (opens ? lineGap * REPEAT_SIGN_ROOM : 0) -
        changeRoom -
        clefRoom;
      barlines.push({ x: barlineX, repeat: kind });
      if (change) {
        let glyphX =
          barlineX + (opens ? lineGap * REPEAT_SIGN_ROOM : 0) + lineGap * KEY_CHANGE_GAP;
        for (const glyph of change.printed) {
          const glyphStep = stepOf(glyph.pitch);
          if (glyphStep === null) {
            continue;
          }
          engravedKeyChanges.push({
            x: glyphX,
            y: -(glyphStep - middleStep) * halfGap,
            kind: glyph.kind,
          });
          glyphX += lineGap * KEY_ACCIDENTAL_WIDTH;
        }
      }
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
      x += columnStep(index + 1);
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
      engravedRests.push({ x, y, value: item.rest, dots: item.dots ?? 0 });
      x += columnStep(index + 1);
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
    const accidental = printedAccidental(note);
    const y = -(step - middleStep) * halfGap;

    /**
     * Every notehead of this note, principal first, ordered low step to high.
     *
     * The chord's own accidentals are spelled by `spellChord`, against the
     * same key and bar the principal was spelled against.
     */
    const heads = chordHeads(note, middleStep, halfGap);

    // **The head furthest from the middle line decides the stem**, which for a
    // chord is not necessarily the principal: a double stop is written with the
    // lower note as the principal and the stem is set by whichever end reaches
    // further from the centre. Ties go down, the same convention as a beamed
    // group.
    //
    // `y` is negative above the middle line, so the two reaches have to be
    // measured from zero rather than compared as absolute values — `|lowest| >=
    // |highest|` looks equivalent and makes every single note stem up, because
    // for one note the two are the same number.
    const highest = Math.min(...heads.map((head) => head.y));
    const lowest = Math.max(...heads.map((head) => head.y));
    const reachAbove = Math.max(0, -highest);
    const reachBelow = Math.max(0, lowest);
    const stemUp = reachBelow > reachAbove;
    // Everything a quarter or shorter has a black notehead.
    const filled = note.value !== 'whole' && note.value !== 'half';

    // **On the side away from the stem**, which is where a reader looks for it
    // and the only side with room. Placed against the outermost notehead so a
    // chord's mark clears the whole stack, and pushed to the next whole space
    // when it would land on a staff line — a staccato dot centred on a line is
    // hard to see against it, which is the same reason the augmentation dot
    // lifts.
    const articulation = note.articulation ?? null;

    // A head a **second** from its neighbour cannot share the column. It goes
    // to the far side of the stem, which is what an engraver does and what
    // keeps two adjacent noteheads from printing on top of each other.
    const seconds = displacedHeads(heads, halfGap);
    const headX = (which: number) =>
      seconds[which] ? (stemUp ? x + lineGap * HEAD_WIDTH : x - lineGap * HEAD_WIDTH) : x;

    // Where each printing accidental sits. The stack and its column order come
    // from `accidentalStack`, which is also what `extraRoom` measured — so the
    // glyphs and the space reserved for them are the same arithmetic. Columns
    // are counted among the heads that **print** something: indexing by chord
    // position pushed a lone flat on the second member two columns out, far
    // enough to land on the previous note, with room reserved for one column
    // and two drawn.
    const stack = accidentalStack(note);
    const columnFor = new Map(stack.map((head, column) => [head.pitch, column]));
    const accidentalXFor = (glyph: Accidental, pitch: string) =>
      x -
      lineGap * (HEAD_HALF + ACCIDENTAL_GAP + (glyph ? ACCIDENTAL_WIDTHS[glyph] : 0)) -
      lineGap * ACCIDENTAL_COLUMN * (columnFor.get(pitch) ?? 0);

    const ledgers = Array.from(
      new Set(
        heads.flatMap((head) =>
          ledgerLinesFor(head.y, staffLines[0], staffLines[4], lineGap),
        ),
      ),
    ).sort((a, b) => a - b);

    const mark = articulation
      ? (() => {
          const above = !stemUp;
          const edge = above ? highest : lowest;
          return {
            kind: articulation,
            // Centred on the note's column, from the glyph's left edge.
            x: x - (lineGap * ARTICULATION_WIDTHS[articulation]) / 2,
            y: edge + (above ? -1 : 1) * lineGap * ARTICULATION_CLEARANCE,
            above,
          };
        })()
      : null;

    /**
     * Where a fermata over this note sits, as the glyph's baseline.
     *
     * **Above the staff, always** — the below-staff form is for the lower
     * voice of a two-voice staff and this app engraves one voice. So the
     * mark clears the higher of the staff's top line and this note's own
     * topmost ink, whichever that turns out to be.
     *
     * Per note rather than levelled across the system, which is the one place
     * this differs from the dynamics below it: a printed part hangs a fermata
     * off its own note, and levelling would float a mark over a low note up to
     * meet a high one somewhere else in the bar.
     */
    const fermataBaseline = () => {
      const stemsUpward = stemUp && note.value !== 'whole';
      const top = Math.min(
        // The staff itself, so a fermata over a note inside the staff still
        // sits outside it.
        staffLines[0],
        highest - HEAD_RADIUS_FACTOR * lineGap,
        // A beam is drawn *at* the stem tip and has thickness, so the tip
        // alone is half a beam short of the actual ink.
        stemsUpward
          ? highest - stemLength - lineGap * BEAM_THICKNESS_FACTOR
          : Infinity,
        ...ledgers,
        mark?.above ? articulationEdge(mark, lineGap) : Infinity,
      );
      return top - lineGap * FERMATA_CLEARANCE;
    };

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
      accidentalX: accidentalXFor(accidental, note.pitch),
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
              // **From the far end of the chord, not from the principal.** A
              // stem that starts at the middle note of a chord leaves the
              // outer one floating unattached.
              from: stemUp ? lowest : highest,
              to: stemUp ? highest - stemLength : lowest + stemLength,
            },
      // **Every head's, merged.** A chord reaching above the staff needs the
      // lines for its top note, and computing them from the principal alone
      // left an upper double-stop notehead floating in space with nothing
      // under it to say which pitch it was.
      ledgers,
      articulation: mark,
      fermata: note.fermata
        ? {
            // Centred on the note's column, from the glyph's left edge —
            // the same convention the articulation follows.
            x: x - (lineGap * FERMATA_WIDTH) / 2,
            y: fermataBaseline(),
          }
        : null,
      // The principal is `y`/`accidental` above; these are the rest.
      // **Accidentals hang off the note's column, not off a displaced head.**
      // A head pushed across the stem sits further right; measuring its
      // accidental from there would put the glyph inside the chord.
      chord: heads.slice(1).map((head, i) => ({
        x: headX(i + 1),
        y: head.y,
        accidental: head.accidental,
        accidentalX: accidentalXFor(head.accidental, head.pitch),
      })),
    });

    x += columnStep(index + 1);
  });

  // The courtesy signature sits between the last note and the closing barline,
  // and the barline moves right to make room for it.
  const courtesyRoom = lineGap * keyChangeWidth(closingChange);
  if (closingChange) {
    let glyphX = x - noteGap / 2 + lineGap * KEY_CHANGE_GAP;
    for (const glyph of closingChange.printed) {
      const glyphStep = stepOf(glyph.pitch);
      if (glyphStep === null) {
        continue;
      }
      engravedKeyChanges.push({
        x: glyphX,
        y: -(glyphStep - middleStep) * halfGap,
        kind: glyph.kind,
      });
      glyphX += lineGap * KEY_ACCIDENTAL_WIDTH;
    }
  }
  const right = x - noteGap / 2 + courtesyRoom + rightPad;
  // The closing barline of this system. A repeat that ends on the score's last
  // measure has no following item to carry the flag, so the caller says.
  barlines.push({ x: right, repeat: closesWithRepeat ? 'end' : null });
  closeSpan(x - noteGap / 2 + courtesyRoom);

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
        atBeat += item.quarters ?? QUARTERS[item.rest];
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
    atBeat += item.quarters ?? QUARTERS[item.value] * (item.dots ? 1.5 : 1);
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

  /**
   * Tuplet brackets, walked over the items the same way the beams were.
   *
   * **Positions come from what is actually on the staff**, so a group is
   * bracketed from its first item to its last whether those are notes, rests,
   * or a mix — a triplet with a rest in it is one triplet, and bracketing only
   * the noteheads would say otherwise.
   *
   * The bracket sits on the **stem side**, which is where an engraver puts it,
   * and clear of whatever is furthest out — a beam, a stem tip, or a notehead
   * on a whole note. Its middle is left empty for the numeral.
   */
  {
    let open: {
      count: number;
      from: number;
      to: number;
      ys: number[];
      /** How the group's stems point. The bracket goes on that side. */
      ups: number;
      downs: number;
    } | null = null;
    let noteAt = 0;
    let restAt = 0;

    const close = () => {
      if (!open || open.to <= open.from) {
        open = null;
        return;
      }
      // **On the stem side**, which is where an engraver puts it and what the
      // stems themselves already decided. This read `min(ys) <= 0` — "is the
      // group high on the staff" — which is a different question with a
      // different answer: a group of high notes has *down* stems, so the
      // bracket went above while every stem pointed away from it.
      //
      // A group whose stems disagree takes the majority; ties go above, which
      // is the safer of the two because a bracket below competes with the note
      // names row.
      const above = open.ups >= open.downs;
      const edge = above ? Math.min(...open.ys) : Math.max(...open.ys);
      const y = edge + (above ? -1 : 1) * lineGap * TUPLET_CLEARANCE;
      tuplets.push({
        from: open.from,
        to: open.to,
        y,
        hook: (above ? 1 : -1) * lineGap * TUPLET_HOOK,
        numberX: (open.from + open.to) / 2,
        count: open.count,
      });
      open = null;
    };

    notes.forEach((item) => {
      if (isMultiRest(item)) {
        close();
        return;
      }
      const drawn = isNote(item) ? engravedNotes[noteAt] : engravedRests[restAt];
      if (isNote(item)) {
        noteAt += 1;
      } else {
        restAt += 1;
      }
      const tuplet = item.tuplet;
      if (!tuplet) {
        close();
        return;
      }
      if (tuplet.starts) {
        close();
        open = { count: tuplet.count, from: drawn.x, to: drawn.x, ys: [], ups: 0, downs: 0 };
      }
      if (!open) {
        // A tuplet whose opening item this build could not draw. Bracketing
        // from the second note would print a group of the wrong length.
        return;
      }
      open.to = drawn.x;
      // Whatever reaches furthest on the stem side: a stem tip if there is
      // one, the notehead if there is not.
      if (isNote(item)) {
        const engraved = engravedNotes[noteAt - 1];
        open.ys.push(engraved.y, engraved.stem?.to ?? engraved.y);
        if (engraved.stemUp) {
          open.ups += 1;
        } else {
          open.downs += 1;
        }
      } else {
        open.ys.push(drawn.y);
      }
    });
    close();
  }

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
    // A chord's outer head is often further out than its principal, and the
    // system's height is measured here — a box sized from the principal alone
    // clips the top note of every double stop.
    for (const head of note.chord) {
      extents.push(
        head.y - HEAD_RADIUS_FACTOR * lineGap,
        head.y + HEAD_RADIUS_FACTOR * lineGap,
      );
    }
    // An accent above a high note is the topmost ink on the system; measured
    // without it the box clips the mark off.
    if (note.articulation) {
      extents.push(articulationEdge(note.articulation, lineGap));
    }
    // And a fermata sits above the accent. Its baseline is its underside, so
    // the box has to reach a whole glyph-height further.
    if (note.fermata) {
      extents.push(note.fermata.y - lineGap * FERMATA_HEIGHT);
    }
    // A thirty-second's outer hooks stack past the stem tip — see
    // `FLAG_OVERSHOOT`. Measured from `stem.to` alone they are cut off.
    const flag = flagEdge(note, lineGap);
    if (flag !== null) {
      extents.push(flag);
    }
  }

  // Rests reach outside the noteheads' box too — a quarter rest spans the
  // staff, and a multi-bar rest's number sits above the top line. A box sized
  // from the notes alone clips the number, which is the only part of a
  // multi-bar rest a musician actually reads.
  for (const rest of engravedRests) {
    extents.push(rest.y - lineGap, rest.y + lineGap);
  }
  // A bracket above a high note is the top of the drawing, and its numeral
  // sits above the line again.
  for (const tuplet of tuplets) {
    extents.push(tuplet.y - lineGap * TUPLET_NUMBER_ROOM, tuplet.y + lineGap * TUPLET_NUMBER_ROOM);
  }
  for (const block of multiRests) {
    extents.push(block.numberY - lineGap * MULTI_REST_NUMBER_FACTOR, block.y + block.halfHeight);
  }

  /**
   * Ties: a short curve joining one notehead to the next of the same pitch.
   *
   * **Three cases, and the two half-curves are not decoration.** A tie whose
   * ends are both on this system is one curve between them. A tie broken by a
   * line break is drawn as a curve trailing off the end of the first system and
   * another leading in on the second — which is what a printed part does, and
   * without it a tie across a break simply vanishes. Ties across barlines are
   * the commonest kind there is, and `packSystems` breaks on barlines, so this
   * is the ordinary case rather than the exotic one.
   *
   * On the side away from the stem, springing from just outside each notehead
   * and flatter than a slur — a tie says "this is one note", not "phrase
   * these".
   */
  {
    let noteIndex = 0;
    let previous: EngravedNote | null = null;
    let previousItem: StaveNote | null = null;

    for (const item of notes) {
      if (!isNote(item)) {
        continue;
      }
      const engraved = engravedNotes[noteIndex];
      noteIndex += 1;

      if (item.tiedFromPrevious) {
        if (previous) {
          ties.push(tieBetween(previous, engraved, lineGap));
        } else {
          // The tie's start is on the system before this one.
          ties.push(tieInFrom(engraved, headX, lineGap));
        }
      }
      previous = engraved;
      previousItem = item;
    }

    // And the other half: a tie leaving the last note of this system.
    if (previousItem?.tiesToNext && previous) {
      ties.push(tieOutTo(previous, right, lineGap));
    }
  }

  /**
   * Slurs, one arc per run of consecutive notes carrying the same id.
   *
   * Runs rather than endpoints, so a slur cut by a system break simply becomes
   * a shorter run on each system — which is what a printed page does, and needs
   * no cross-system bookkeeping at all.
   *
   * A run of one note draws nothing: a slur has to join two notes to mean
   * anything, and a single-note arc is a smudge over a notehead.
   */
  {
    let run: { id: number; notes: EngravedNote[] } | null = null;
    let noteIndex = 0;

    const close = () => {
      if (run && run.notes.length > 1) {
        slurs.push(arcOver(run.notes, lineGap));
      }
      run = null;
    };

    for (const item of notes) {
      if (!isNote(item)) {
        // A rest inside a slur is unusual and legal; it does not break the arc,
        // which is why this only skips rather than closing the run.
        continue;
      }
      const engraved = engravedNotes[noteIndex];
      noteIndex += 1;
      if (item.slur === undefined) {
        close();
        continue;
      }
      if (run && run.id === item.slur) {
        run.notes.push(engraved);
      } else {
        close();
        run = { id: item.slur, notes: [engraved] };
      }
    }
    close();
  }

  /**
   * Ending brackets, above everything else on the system.
   *
   * Built here rather than in the note loop because they have to clear the
   * whole system — beams, slurs, articulations, a tuplet bracket — and only
   * here is that known. Spanned from `measureSpans`, so a bracket cut by a line
   * break simply covers the measures this system holds, with the right-hand
   * hook only on the system that actually finishes it.
   */
  for (const ending of endingSpans) {
    const spans = measureSpans.filter(
      (span) =>
        span.measureNumber !== undefined &&
        span.measureNumber >= ending.from &&
        span.measureNumber <= ending.to,
    );
    if (spans.length === 0) {
      continue;
    }
    const y = Math.min(...extents) - lineGap * ENDING_CLEARANCE;
    endings.push({
      // **Never back into the clef.** A measure that opens a system has its
      // span start half a note-gap before the music, which is inside the key
      // signature — harmless for a barline, which is not drawn there, and a
      // bracket printed over the sharps otherwise.
      from: Math.max(headX, Math.min(...spans.map((span) => span.from))),
      to: Math.max(...spans.map((span) => span.to)),
      y,
      hook: lineGap * ENDING_HOOK,
      labelY: y + lineGap * ENDING_LABEL_BASELINE,
      labelSize: lineGap * ENDING_LABEL_SIZE,
      label: ending.label,
      closesRight:
        ending.closed && spans.some((span) => span.measureNumber === ending.to),
    });
    extents.push(y);
  }

  /**
   * Dynamics, on one baseline under the whole system.
   *
   * Placed last, because the baseline is measured from everything already on
   * the system — a stem reaching below the staff, a low ledger line, a rest.
   * A printed part lines them up rather than following each note's own depth.
   */
  const dynamics: EngravedDynamic[] = [];
  {
    const marked = notes.flatMap((item, index) =>
      isNote(item) && item.dynamic ? [{ item, index }] : [],
    );
    if (marked.length > 0) {
      let noteIndex = 0;
      const positionOf = new Map<number, number>();
      notes.forEach((item, index) => {
        if (isNote(item)) {
          positionOf.set(index, noteIndex);
          noteIndex += 1;
        }
      });
      const spelledMarks = marked.flatMap(({ item, index }) => {
        const engraved = engravedNotes[positionOf.get(index) ?? -1];
        const spelled = engraved && spellDynamic(item.dynamic ?? '', lineGap);
        return engraved && spelled ? [{ engraved, spelled }] : [];
      });
      if (spelledMarks.length > 0) {
        // The tallest mark on the system sets the baseline and the deepest
        // sets the box, so a row of them stays level and none of them touches
        // anything. An `f` next to an `m` pushes both down; that is what a
        // printed part does too.
        const ascent = Math.max(...spelledMarks.map((m) => m.spelled.ascent));
        const descent = Math.max(...spelledMarks.map((m) => m.spelled.descent));
        const baseline =
          Math.max(...extents) + lineGap * DYNAMIC_CLEARANCE + ascent;
        for (const { engraved, spelled } of spelledMarks) {
          dynamics.push({
            x: engraved.x,
            y: baseline,
            glyphs: spelled.glyphs,
            width: spelled.width,
          });
        }
        extents.push(baseline + descent);
      }
    }
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
      tuplets,
      slurs,
      ties,
      endings,
      dynamics,
      head,
      keyChanges: engravedKeyChanges,
      clefChanges: engravedClefChanges,
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

/**
 * The far edge of an articulation mark, where the glyph actually stops.
 *
 * `y` is its origin; the glyph reaches away from the staff from there. Anything
 * measuring room — the system's height, a slur passing over — has to use this
 * or it is measuring the mark's near edge and clipping the rest.
 */
/**
 * How far a flag reaches past the end of its stem, in staff spaces, by how
 * many hooks it has.
 *
 * **Measured out of Bravura, not estimated** — the same rule the notehead
 * widths and `ARTICULATION_HEIGHTS` follow. Every flag is drawn from the stem
 * tip and reaches 3.25 spaces back toward the notehead whatever its value, so
 * the eighth and the sixteenth sit entirely inside a 3.5-space stem and need
 * nothing. The extra hooks of a thirty-second and a sixty-fourth stack the
 * *other* way, past the tip: 0.60 and 1.39 spaces up, 0.69 and 1.50 down.
 *
 * The system's box is measured from `stem.to`, so without this the outer hooks
 * of a high thirty-second are simply cut off — the same way an accent above a
 * high note was, and for the same reason.
 *
 * The larger of each up/down pair, so one number is right in both directions.
 */
const FLAG_OVERSHOOT: Record<number, number> = { 1: 0.06, 2: 0.05, 3: 0.69, 4: 1.50 };

/** The outermost point a note's flag reaches, or null if it carries none. */
function flagEdge(note: EngravedNote, lineGap: number): number | null {
  if (note.flags === 0 || !note.stem) {
    return null;
  }
  const reach = (FLAG_OVERSHOOT[note.flags] ?? 0) * lineGap;
  return note.stem.to + (note.stemUp ? -reach : reach);
}

function articulationEdge(
  mark: NonNullable<EngravedNote['articulation']>,
  lineGap: number,
): number {
  const reach = ARTICULATION_HEIGHTS[mark.kind] * lineGap;
  return mark.y + (mark.above ? -reach : reach);
}

/**
 * The repeat dots a barline carries, from the item that follows it.
 *
 * Both flags at once is `both` — a section ending where the next begins, one
 * barline with dots on either side.
 */
function repeatKind(item: StaveItem): EngravedBarline['repeat'] {
  const starts = item.repeatStartsBefore === true;
  const ends = item.repeatEndsBefore === true;
  if (starts && ends) {
    return 'both';
  }
  return starts ? 'start' : ends ? 'end' : null;
}

/**
 * The letters a dynamic is spelled with, and how wide each is.
 *
 * Measured out of Bravura, like the notehead widths and the flag overshoots.
 * Every one of the schema's twelve marks is a run of these five, which is how
 * an engraver sets them and why the font provides letters rather than words.
 */
const DYNAMIC_LETTERS: Record<
  string,
  {
    glyph: string;
    width: number;
    /**
     * Where the ink is, relative to the pen and the baseline, in staff spaces.
     *
     * `left`/`right` are signed, positive rightwards; `top`/`bottom` are how
     * far the glyph rises above and falls below the baseline, both positive.
     * Read straight out of the font — `fontTools`' `BoundsPen` over
     * `Bravura.otf`, divided by a quarter of the em, which is a staff space in
     * SMuFL. **Not the advance width**: `f` is drawn 0.56 spaces to the *left*
     * of its own pen and rises 1.78 above its baseline, and both of those are
     * why the first version of this collided with a note.
     */
    ink: { left: number; right: number; top: number; bottom: number };
  }
> = {
  p: {
    glyph: '\uE520',
    width: 1.46,
    ink: { left: -0.36, right: 1.46, top: 1.1, bottom: 0.57 },
  },
  m: {
    glyph: '\uE521',
    width: 1.75,
    ink: { left: -0.08, right: 1.78, top: 1.1, bottom: 0.04 },
  },
  f: {
    glyph: '\uE522',
    width: 1.46,
    ink: { left: -0.56, right: 1.46, top: 1.78, bottom: 0.61 },
  },
  s: {
    glyph: '\uE524',
    width: 0.92,
    ink: { left: 0, right: 0.92, top: 1.09, bottom: 0.04 },
  },
  z: {
    glyph: '\uE525',
    width: 0.98,
    ink: { left: -0.12, right: 0.98, top: 1.07, bottom: 0.04 },
  },
};

/**
 * The white the dynamics keep between themselves and the music, in staff
 * spaces.
 *
 * **From the top of the tallest letter, not from its baseline.** The first
 * version put the *baseline* this far under the system's lowest ink, which
 * reads as the same thing and is not: `f` rises 1.78 spaces above its own
 * baseline, so a clearance of 1.4 drew it 0.38 spaces *into* the music. On the
 * one fixture that carries a printed dynamic — Wohlfahrt No. 28, whose first
 * note is a D4, below the staff in treble — the `f` and the notehead fused
 * into a single blob. Every unit test passed: they knew where the baseline was
 * and the font's own metrics were nowhere in the calculation.
 */
const DYNAMIC_CLEARANCE = 0.7;

/**
 * The glyphs a dynamic is spelled with and the box they occupy, or null if it
 * is not one this draws.
 *
 * `width` is the advance the letters take, which is what centres the mark on
 * its notehead. `left`, `right`, `ascent` and `descent` are where the *ink*
 * goes, which is what keeps it off everything else — the two differ by more
 * than half a staff space for `f`, so a placement that uses the advance for
 * both is a placement that overlaps.
 */
export function spellDynamic(
  mark: string,
  lineGap: number,
): {
  glyphs: string;
  width: number;
  left: number;
  right: number;
  ascent: number;
  descent: number;
} | null {
  let glyphs = '';
  let pen = 0;
  let left = Infinity;
  let right = -Infinity;
  let ascent = 0;
  let descent = 0;
  for (const letter of mark) {
    const found = DYNAMIC_LETTERS[letter];
    // **Dropped rather than approximated**, the same rule the note values
    // follow: a mark spelled with a letter this has no glyph for would come
    // out as a shorter mark, which is a different instruction.
    if (!found) {
      return null;
    }
    glyphs += found.glyph;
    left = Math.min(left, pen + found.ink.left);
    right = Math.max(right, pen + found.ink.right);
    ascent = Math.max(ascent, found.ink.top);
    descent = Math.max(descent, found.ink.bottom);
    pen += found.width;
  }
  return glyphs
    ? {
        glyphs,
        width: pen * lineGap,
        left: left * lineGap,
        right: right * lineGap,
        ascent: ascent * lineGap,
        descent: descent * lineGap,
      }
    : null;
}

/** How far outside a notehead a tie springs, in staff spaces. */
const TIE_INSET = 0.75;

/** How far a tie clears the notehead it curves away from, in staff spaces. */
const TIE_CLEARANCE = 0.55;

/** A tie's arc height, in staff spaces. Flatter than a slur, deliberately. */
const TIE_BULGE = 0.55;

/** How far a half tie reaches toward the edge of its system, in staff spaces. */
const TIE_HALF_REACH = 1.8;

/**
 * Which side of the notehead a tie curves to.
 *
 * Away from the stem, like a slur — but read from the note that **starts** the
 * tie, because that is the one whose stem the curve has to avoid. Positive is
 * down the page.
 */
function tieSide(note: EngravedNote): number {
  return note.stemUp ? 1 : -1;
}

/** The curve joining two noteheads of the same pitch. */
function tieBetween(
  from: EngravedNote,
  to: EngravedNote,
  lineGap: number,
): EngravedSlur {
  const side = tieSide(from);
  const y = from.y + side * lineGap * TIE_CLEARANCE;
  const left = from.x + lineGap * TIE_INSET;
  const right = to.x - lineGap * TIE_INSET;
  return {
    from: { x: left, y },
    to: { x: right, y },
    // A quadratic reaches half way to its control point, so the visible arc is
    // half of this.
    control: { x: (left + right) / 2, y: y + side * 2 * lineGap * TIE_BULGE },
  };
}

/**
 * The half of a tie that leaves the last note of a system.
 *
 * Stops short of the closing barline rather than touching it: a tie that runs
 * into the barline reads as joined to it.
 */
function tieOutTo(from: EngravedNote, edge: number, lineGap: number): EngravedSlur {
  const side = tieSide(from);
  const y = from.y + side * lineGap * TIE_CLEARANCE;
  const left = from.x + lineGap * TIE_INSET;
  const right = Math.min(edge - lineGap * 0.5, left + lineGap * TIE_HALF_REACH);
  return {
    from: { x: left, y },
    to: { x: right, y: y + side * lineGap * TIE_BULGE },
    control: { x: (left + right) / 2, y: y + side * 2 * lineGap * TIE_BULGE },
  };
}

/** The half of a tie that arrives at the first note of a system. */
function tieInFrom(to: EngravedNote, headX: number, lineGap: number): EngravedSlur {
  const side = tieSide(to);
  const y = to.y + side * lineGap * TIE_CLEARANCE;
  const right = to.x - lineGap * TIE_INSET;
  const left = Math.max(headX, right - lineGap * TIE_HALF_REACH);
  return {
    from: { x: left, y: y + side * lineGap * TIE_BULGE },
    to: { x: right, y },
    control: { x: (left + right) / 2, y: y + side * 2 * lineGap * TIE_BULGE },
  };
}

/** How far above the system's topmost ink an ending bracket sits. */
const ENDING_CLEARANCE = 1.2;

/**
 * How far the bracket's end hooks drop, in staff spaces.
 *
 * Deep enough to hold the number under the line rather than through it: the
 * numeral's cap reaches about 0.9 spaces above its baseline, and the baseline
 * sits at `ENDING_LABEL_BASELINE`.
 */
const ENDING_HOOK = 1.35;

/** Where the number's baseline sits below the bracket, in staff spaces. */
const ENDING_LABEL_BASELINE = 1.15;

/** The number's size, in staff spaces. */
const ENDING_LABEL_SIZE = 1.3;

/** How far from a notehead's centre a slur's end springs, in staff spaces. */
const SLUR_CLEARANCE = 1.1;

/** The shallowest and deepest a slur arcs, in staff spaces. */
const SLUR_MIN_BULGE = 0.9;
const SLUR_MAX_BULGE = 2.6;

/**
 * How much of the span becomes arc height. A long slur is flatter in
 * proportion, which is what keeps a six-note slur from looking like a rainbow.
 */
const SLUR_SPAN_FACTOR = 0.06;

/**
 * The curve over one run of slurred notes.
 *
 * **On the notehead side**, which is the opposite of the stems — a slur drawn
 * through a group's stems is the same mistake as a tuplet bracket on the wrong
 * side, and it is one an engraver never makes. The group's own stems decide,
 * by majority; a tie goes above, where there is more room than under a staff
 * that also carries a name row.
 */
function arcOver(notes: EngravedNote[], lineGap: number): EngravedSlur {
  // **Opposite the stems**, which is the reverse of the tuplet bracket a few
  // lines down — a bracket goes on the stem side, a slur on the notehead side.
  // Written the same way round as the bracket at first, which put every slur
  // through the stems it was supposed to arc over; the comment said the right
  // thing and the expression said the other one.
  const ups = notes.filter((note) => note.stemUp).length;
  const downs = notes.length - ups;
  const above = downs >= ups;

  // Every notehead of every note in the run, chords included: an arc measured
  // from the principals alone would cut through a double stop's upper note.
  const ys = notes.flatMap((note) => [
    note.y,
    ...note.chord.map((head) => head.y),
    // **Articulations sit under the slur, not through it.** Both go on the
    // notehead side, so a slur measured from the noteheads alone is drawn
    // straight across a row of staccato dots.
    ...(note.articulation && note.articulation.above === above
      ? [articulationEdge(note.articulation, lineGap)]
      : []),
  ]);
  const edge = above ? Math.min(...ys) : Math.max(...ys);
  const y = edge + (above ? -1 : 1) * lineGap * SLUR_CLEARANCE;

  const from = notes[0];
  const to = notes[notes.length - 1];
  const span = to.x - from.x;
  const bulge =
    lineGap *
    Math.min(SLUR_MAX_BULGE, SLUR_MIN_BULGE + (span / lineGap) * SLUR_SPAN_FACTOR);

  return {
    from: { x: from.x, y },
    to: { x: to.x, y },
    control: {
      x: (from.x + to.x) / 2,
      // Twice the bulge: a quadratic Bézier reaches only half way to its
      // control point, so the visible arc height is half of this.
      y: y + (above ? -2 : 2) * bulge,
    },
  };
}

/** Shift every coordinate in a system down by `dy`. */
/**
 * A system before it has been stacked, which is every field but its place.
 *
 * `top`/`bottom` are what stacking decides, so they cannot be filled in by the
 * routine that lays a single system out — it works in its own coordinates,
 * where the middle staff line is zero.
 */
type PlacedSystem = Omit<EngravedSystem, 'top' | 'bottom'>;

function shift(system: PlacedSystem, dy: number): PlacedSystem {
  return {
    staffLines: system.staffLines.map((y) => y + dy),
    barlines: system.barlines,
    dynamics: system.dynamics.map((mark) => ({ ...mark, y: mark.y + dy })),
    nameY: system.nameY + dy,
    width: system.width,
    notes: system.notes.map((note) => ({
      ...note,
      y: note.y + dy,
      ledgers: note.ledgers.map((y) => y + dy),
      // The rest of the chord moves with it. Missed here, a double stop's upper
      // note would stay behind on the first system's baseline.
      chord: note.chord.map((head) => ({ ...head, y: head.y + dy })),
      articulation: note.articulation
        ? { ...note.articulation, y: note.articulation.y + dy }
        : null,
      fermata: note.fermata ? { ...note.fermata, y: note.fermata.y + dy } : null,
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
    tuplets: system.tuplets.map((t) => ({ ...t, y: t.y + dy })),
    endings: system.endings.map((ending) => ({
      ...ending,
      y: ending.y + dy,
      labelY: ending.labelY + dy,
    })),
    ties: system.ties.map((tie) => ({
      from: { ...tie.from, y: tie.from.y + dy },
      to: { ...tie.to, y: tie.to.y + dy },
      control: { ...tie.control, y: tie.control.y + dy },
    })),
    slurs: system.slurs.map((slur) => ({
      from: { ...slur.from, y: slur.from.y + dy },
      to: { ...slur.to, y: slur.to.y + dy },
      control: { ...slur.control, y: slur.control.y + dy },
    })),
    head: {
      clef: system.head.clef ? { ...system.head.clef, y: system.head.clef.y + dy } : null,
      key: system.head.key.map((a) => ({ ...a, y: a.y + dy })),
      time: system.head.time,
    },
    keyChanges: system.keyChanges.map((glyph) => ({ ...glyph, y: glyph.y + dy })),
    clefChanges: system.clefChanges.map((glyph) => ({ ...glyph, y: glyph.y + dy })),
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

  const truncated = options.maxNotes ? truncateAtBar(notes, options.maxNotes) : notes;
  // **Before anything is packed or measured.** Which accidentals print depends
  // on the key signature and on what came earlier in the same bar, so it is a
  // property of the score in order — not of a system, which is a slice of it.
  const capped = spellAccidentals(truncated, options.head?.key ?? []);
  /**
   * The clef in force at each item of `capped`, so a system that starts after
   * a change opens its head in the clef the reader is actually in.
   *
   * The same shape as the key's `keyAtStart` below and for the same reason: a
   * clef is printed once and holds, so the value a *later* system opens with
   * is not the one the piece opens with. Without this the second system of a
   * tenor passage draws a bass clef over notes placed for tenor.
   */
  const clefAt: Clef[] = [];
  {
    let running = clef;
    for (const item of capped) {
      if (item.clefChange) {
        running = item.clefChange;
      }
      clefAt.push(running);
    }
  }

  // Positioned for this clef, once, because what a change prints depends on
  // the key before it — which may have been set on an earlier system.
  const keyChanges = resolveKeyChanges(capped, options.head?.key ?? [], clef);

  /**
   * Where the lines break.
   *
   * **By the width a bar will take, not by how many notes are in it.** The
   * count was blind to `extraRoom` — accidentals, repeat signs, ties and now
   * dynamics all reserve room the packer never knew it was spending — so a
   * system could be handed more music than it had width for. `justify` then
   * divided a *negative* remainder among the columns and the notes walked
   * backwards through each other. Reached first by a bar of dynamics, where
   * `ppp` printed through the `pp` after it; a chromatic run gets within a
   * staff space of it on a narrow phone.
   *
   * The room a bar asks for is measured over the whole piece rather than per
   * system, so a bar that opens a line is costed as if it followed the one
   * before. That over-estimates by at most one item's reservation, which is
   * the safe direction: it breaks a line early, never late.
   */
  const bars = splitBars(capped);
  const runs = options.maxWidth
    ? (() => {
        const room = extraRoom(capped, lineGap, keyChanges);
        let cursor = 0;
        const costs = bars.map((bar) => {
          const cost = bar.reduce(
            (total, _item, index) => total + noteGap + (room[cursor + index] ?? 0),
            0,
          );
          cursor += bar.length;
          return cost;
        });
        // What each bar would cost the line in front of it, as a courtesy
        // signature, if it turned out to open a line. See `packSystems`.
        cursor = 0;
        const courtesy = bars.map((bar) => {
          const room = lineGap * keyChangeWidth(keyChanges[cursor]);
          cursor += bar.length;
          return room;
        });
        // The head is on every system, so it is off the budget for all of
        // them; the metre only on the first, and costing it everywhere breaks
        // a line one bar early at worst.
        const head = options.head
          ? headRoom(
              {
                clef: options.head.clef,
                key: options.head.key,
                time: options.head.time,
              },
              lineGap,
            )
          : 0;
        const budget = Math.max(
          noteGap,
          (options.maxWidth ?? 0) - leftPad - rightPad - head,
        );
        return packSystems(bars, costs, budget, courtesy);
      })()
    : [capped];

  const padding = PADDING_FACTOR * lineGap;
  const gap = lineGap * SYSTEM_GAP_FACTOR;

  const systems: EngravedSystem[] = [];
  let cursor = padding;
  let width = 0;
  /** Where this run starts in `capped`; the runs partition it in order. */
  let runStart = 0;

  for (const run of runs) {
    if (run.length === 0) {
      continue;
    }
    /**
     * The key this system opens in: the last change at or before its first
     * item, else the head's. **At or before** — a change on the first bar of
     * a line is shown by the head, in the new key, and is not printed again
     * after the barline, which is why the run's own first entry is dropped.
     */
    const runChanges = keyChanges.slice(runStart, runStart + run.length);
    const lastChange = keyChanges
      .slice(0, runStart + 1)
      .reduce<ResolvedKeyChange | null>((latest, change) => change ?? latest, null);
    const keyAtStart = lastChange ? lastChange.key : (options.head?.key ?? []);
    runChanges[0] = null;
    runStart += run.length;
    // The change that opens the next line, printed at the end of this one.
    const closingChange = keyChanges[runStart] ?? null;
    // A system's width is leftPad + (n - ½) gaps + rightPad, because the final
    // barline sits half a gap past the last note. Solve that for the gap that
    // makes it exactly `maxWidth`.
    // The accidentals' room is spent before the columns are, or justification
    // would hand out width that is already taken and the system would run past
    // its own right margin.
    const reserved =
      extraRoom(run, lineGap, runChanges).reduce((a, b) => a + b, 0) +
      lineGap * keyChangeWidth(closingChange);
    // The clef and key signature take their room out of the same width, and
    // they take it from **every** system — the metre only from the first, which
    // is why this is computed per run rather than once.
    // The clef this run is written in: the one in force at its first item.
    const clefHere = clefAt[runStart - run.length] ?? clef;
    const headRequest: HeadRequest | null = options.head
      ? {
          // Only when the caller asked for a clef at all — `head.clef` null
          // means nothing has read one, which stays true after a change.
          clef: options.head.clef ? clefHere : null,
          key: keyAtStart,
          time: systems.length === 0 ? options.head.time : null,
        }
      : null;
    const headWidth = headRoom(headRequest, lineGap);
    const stretched =
      options.justify && options.maxWidth && run.length > 1
        ? Math.min(
            // Can come out negative: the reservations are not part of this
            // division and can exceed the whole system. `layoutSystem` floors
            // each column as it spends it — see `step` — because it is the
            // *distance* that has to clear a notehead, and an item that
            // reserves room already has more of one than this.
            (options.maxWidth - leftPad - rightPad - reserved - headWidth) /
              (run.length - 0.5),
            noteGap * MAX_JUSTIFY_STRETCH,
          )
        : noteGap;
    /**
     * What this system's closing barline carries.
     *
     * Two cases, and the second is the one that lost information silently.
     *
     *  - The **last** system closes the piece, so a repeat ending on the final
     *    measure lands here — nothing follows it to carry a flag, which is why
     *    `closesWithRepeat` is passed in at all.
     *  - A repeat ending **at a system break** is marked on the first item of
     *    the *next* run, and `layoutSystem` draws no barline before its first
     *    item — so the sign was dropped. A printed part puts it at the end of
     *    the line that finishes the section, which is here.
     */
    const runIndex = runs.indexOf(run);
    const isLastRun = runIndex === runs.length - 1;
    const opensNext = runs[runIndex + 1]?.[0];
    const closesWithRepeat = isLastRun
      ? options.closesWithRepeat === true
      : opensNext?.repeatEndsBefore === true;

    const laid = layoutSystem(
      run,
      clefHere,
      lineGap,
      stretched,
      leftPad,
      rightPad,
      nameRow,
      beatQuarters,
      headRequest,
      closesWithRepeat,
      options.endings ?? [],
      runChanges,
      closingChange,
    );
    const dy = cursor - laid.top;
    systems.push({
      ...shift(laid.system, dy),
      top: laid.top + dy,
      bottom: laid.bottom + dy,
    });
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
