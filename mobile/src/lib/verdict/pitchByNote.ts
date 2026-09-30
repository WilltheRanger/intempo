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
 * A tapped note in one line: "E♭ · 7 notes, a little sharp".
 *
 * **Words, not cents**, as the bars are (`pitchWord`, 2026-09-29): "17 cents
 * sharp" asks a student to know what a cent is, and the dot's colour and
 * height already say how far.
 */
export function noteDetail(mark: NoteMark): string {
  const word =
    mark.band === 'in_tune'
      ? 'in tune'
      : `${mark.band === 'slight' ? 'a little ' : ''}${mark.cents > 0 ? 'sharp' : 'flat'}`;
  const name = mark.fullName.charAt(0).toUpperCase() + mark.fullName.slice(1);
  return `${name} · ${mark.notes} ${mark.notes === 1 ? 'note' : 'notes'}, ${word}`;
}
