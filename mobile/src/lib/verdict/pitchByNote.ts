import type { NoteIntonation, TakeIntonation } from '../../data/types';
import { pitchBand, type PitchBand } from './intonation';

/**
 * Which written notes ran sharp or flat — by note, where the chart above it is
 * by bar (the owner, 2026-09-30: "Note lengths + pitch by note", then "Result
 * + Insights"). A bar that is flat says where; that every E-flat sits sharp
 * says what to fix: the finger that reaches for it.
 *
 * The measurement is the pipeline's (`backend/app/services/intonation.py`,
 * `_by_note`); this is what the screen shows of it and says about it.
 */

/**
 * Readings a note needs to be shown for one take, for a take stored before
 * the threshold travelled with it. `by_note_show_notes` in config.toml.
 */
export const BY_NOTE_SHOW_NOTES = 4;

/** One written note on the row, low to high. */
export interface NoteMark {
  midi: number;
  /** The letter as the page spells it: "E♭", "F♯". */
  name: string;
  /**
   * What a sentence calls it: the name, or "low G" and "high G" where the
   * row holds the same letter in two octaves — an open string and the same
   * letter stopped are different fingers.
   */
  fullName: string;
  /** Against the take's tuning. Positive is sharp. */
  cents: number;
  notes: number;
  bars: number[];
  band: PitchBand;
}

const ACCIDENTALS: Record<string, string> = {
  '': '',
  '#': '♯',
  b: '♭',
  '##': '𝄪',
  x: '𝄪',
  bb: '𝄫',
};

/** "Eb3" → "E♭", "F#4" → "F♯": the letter and its accidental, no octave. */
export function spell(pitch: string): string {
  const match = /^([A-G])(##|bb|#|b|x)?-?\d+$/.exec(pitch);
  if (!match) return pitch;
  return match[1] + (ACCIDENTALS[match[2] ?? ''] ?? '');
}

/**
 * Written notes as marks, low to high, each named so that a letter in two
 * octaves reads as two notes. `thresholds` supplies the bands, which travel
 * with a take.
 */
export function noteMarks(
  notes: readonly NoteIntonation[],
  thresholds: Pick<TakeIntonation, 'inTuneCents' | 'slightCents'>,
): NoteMark[] {
  const sorted = [...notes].sort((a, b) => a.midi - b.midi);
  const names = sorted.map((n) => spell(n.pitch));
  return sorted.map((n, i) => {
    const same = names.flatMap((name, j) => (name === names[i] ? [j] : []));
    return {
      midi: n.midi,
      name: names[i],
      fullName: octaveName(names[i], same.indexOf(i), same.length, n.pitch),
      cents: n.cents,
      notes: n.notes,
      bars: n.bars,
      band: pitchBand(n.cents, thresholds),
    };
  });
}

function octaveName(name: string, place: number, of: number, pitch: string): string {
  if (of <= 1) return name;
  if (of === 2) return `${place === 0 ? 'low' : 'high'} ${name}`;
  // Three octaves of one letter on one page is rare enough to spell out.
  const octave = /-?\d+$/.exec(pitch)?.[0] ?? '';
  return `${name}${octave}`;
}

/**
 * The notes one take shows: those read often enough to mean something on
 * their own (`byNoteShowNotes`, which travels with the take).
 */
export function takeNoteMarks(intonation: TakeIntonation | null): NoteMark[] {
  if (!intonation) return [];
  const least = intonation.byNoteShowNotes ?? BY_NOTE_SHOW_NOTES;
  const shown = (intonation.byNote ?? []).filter((n) => n.notes >= least);
  return noteMarks(shown, intonation);
}

/**
 * The line over the row: "Your E♭s were sharp", "Your E♭s and Gs were sharp",
 * "Every note in tune" — or nothing when there is no row.
 *
 * **At most two notes, and only the same way.** The strongest off note, and
 * the next strongest only when it went the same way: "your E♭s were sharp and
 * your Cs flat" asks two different corrections in one breath, and the row
 * shows the second anyway. `tense` is "were" for one take and "run" for a
 * habit across takes (`lib/insights/notesHabit.ts`).
 */
export function notesLine(marks: readonly NoteMark[], tense: 'take' | 'habit'): string | null {
  if (marks.length === 0) return null;
  const named = namedMarks(marks);
  if (named.length === 0) return 'Every note in tune';
  return `Your ${named.map((m) => `${m.fullName}s`).join(' and ')} ${
    tense === 'take' ? 'were' : 'run'
  } ${named[0].cents > 0 ? 'sharp' : 'flat'}`;
}

/**
 * The notes `notesLine` names, strongest first — which the row sets in the
 * heavier weight, so the sentence and the picture point at the same notes.
 */
export function namedMarks(marks: readonly NoteMark[]): NoteMark[] {
  const off = marks
    .filter((m) => m.band !== 'in_tune')
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  const first = off[0];
  if (!first) return [];
  const second = off.find((m) => m !== first && Math.sign(m.cents) === Math.sign(first.cents));
  return second ? [first, second] : [first];
}

/**
 * A tapped note as a plain sentence: "Your 7 E♭s were a little sharp".
 *
 * **A sentence, like the passage line above it** (the owner, 2026-09-30, of
 * "Bars 15–24 · about 95, aiming for 104": "let's fix this jargon"), and
 * **words, not cents**, as the bars are (`pitchWord`, 2026-09-29): the dot's
 * colour and height already say how far.
 */
export function noteDetail(mark: NoteMark): string {
  const word =
    mark.band === 'in_tune'
      ? 'in tune'
      : `${mark.band === 'slight' ? 'a little ' : ''}${mark.cents > 0 ? 'sharp' : 'flat'}`;
  return mark.notes === 1
    ? `Your one ${mark.fullName} was ${word}`
    : `Your ${mark.notes} ${mark.fullName}s were ${word}`;
}

/**
 * The narrowest a note's column may be: room for its name ("F♯" at caption
 * size) and a finger. A violin study can read twenty notes; at the phone's
 * width, twenty columns ran their names together and were ten points wide.
 */
export const NOTE_COLUMN_MIN = 30;

export interface FittedMarks {
  /** Low to high, as many as fit. */
  shown: NoteMark[];
  /** How many were left out. */
  hidden: number;
  /** Whether every note left out was in tune. */
  hiddenInTune: boolean;
}

/**
 * As many notes as `room` columns hold, keeping the ones worth seeing: those
 * in `keep` (the notes the line names, and a tapped one), then the others off
 * by how far, then the in-tune notes read most often. **A note off pitch is
 * never left out for one in tune** — what drops is the in-tune detail, which
 * one sentence can say instead (`otherNotesLine`).
 */
export function fitNoteMarks(
  marks: readonly NoteMark[],
  room: number,
  keep: readonly number[] = [],
): FittedMarks {
  if (marks.length <= room) return { shown: [...marks], hidden: 0, hiddenInTune: true };
  const rank = (m: NoteMark) =>
    keep.includes(m.midi) ? 0 : m.band !== 'in_tune' ? 1 : 2;
  const kept = [...marks]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (rank(a) === 2 ? b.notes - a.notes : Math.abs(b.cents) - Math.abs(a.cents)) ||
        a.midi - b.midi,
    )
    .slice(0, Math.max(1, room));
  const left = marks.filter((m) => !kept.includes(m));
  return {
    shown: kept.sort((a, b) => a.midi - b.midi),
    hidden: left.length,
    hiddenInTune: left.every((m) => m.band === 'in_tune'),
  };
}

/**
 * Under a row that could not hold every note: "The other 13 were in tune",
 * "The other one runs in tune" — or, when notes off pitch outnumbered the
 * room, how many are not shown.
 */
export function otherNotesLine(fitted: FittedMarks, tense: 'take' | 'habit'): string | null {
  const { hidden, hiddenInTune } = fitted;
  if (hidden === 0) return null;
  if (!hiddenInTune) return hidden === 1 ? 'One more note not shown' : `${hidden} more notes not shown`;
  if (hidden === 1) return tense === 'take' ? 'The other one was in tune' : 'The other one runs in tune';
  return `The other ${hidden} ${tense === 'take' ? 'were' : 'run'} in tune`;
}
