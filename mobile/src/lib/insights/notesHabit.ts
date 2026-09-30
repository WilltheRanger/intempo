import type { NoteIntonation, TakeResult } from '../../data/types';
import { namedMarks, noteMarks, notesLine, type NoteMark } from '../verdict/pitchByNote';

/**
 * "By note" on Insights: which written notes run sharp or flat across takes —
 * the result screen's note row, pooled, because a habit is what repeats (the
 * owner, 2026-09-30, "Result + Insights").
 *
 * **Pooled, then named only if it held.** Each take's median for a note is
 * weighted by how many times it was read, which recovers a note one take heard
 * only a few times — the owner's 0313 take read its E-flats three times. A
 * note is named only when most takes that played it put it on the same side:
 * two takes at +14 and -12 pool to "in tune", which is what they say together.
 */

export interface NotesHabit {
  /** Low to high, pooled across the takes that played each note. */
  marks: NoteMark[];
  /** "Your E♭s run sharp", "Every note in tune". */
  line: string;
  /** "Sharp in both takes", "Sharp in 5 of 7 takes"; null when nothing is named. */
  caption: string | null;
  /** The notes the line names, by MIDI number. */
  named: number[];
  /** The newest take's in-tune width, drawn behind the row. */
  inTuneCents: number;
}

/** A note must be heard in this many takes to be a habit rather than a take. */
const MIN_TAKES = 2;
/** ...and read this many times across them. */
const MIN_NOTES = 6;
/** The share of its takes that must put it on the pooled side to name it. */
const SAME_SIDE = 2 / 3;

/**
 * The pooled row, or null with fewer than two takes read by note — the older
 * takes, stored before 2026-09-30, carry none. `takes` arrive newest first.
 */
export function notesHabitFrom(takes: readonly TakeResult[]): NotesHabit | null {
  const read = takes.filter(
    (t) => t.failure === null && t.status === 'ok' && (t.intonation?.byNote?.length ?? 0) > 0,
  );
  if (read.length < MIN_TAKES) return null;
  const newest = read[0].intonation!;

  const byMidi = new Map<number, NoteIntonation[]>();
  for (const t of read) {
    for (const n of t.intonation!.byNote) {
      byMidi.set(n.midi, [...(byMidi.get(n.midi) ?? []), n]);
    }
  }

  const pooled: NoteIntonation[] = [];
  const sides = new Map<number, { same: number; of: number }>();
  for (const [midi, readings] of byMidi) {
    const notes = readings.reduce((sum, r) => sum + r.notes, 0);
    if (readings.length < MIN_TAKES || notes < MIN_NOTES) continue;
    const cents = readings.reduce((sum, r) => sum + r.cents * r.notes, 0) / notes;
    pooled.push({
      pitch: mostWritten(readings),
      midi,
      cents: Math.round(cents * 10) / 10,
      notes,
      bars: [...new Set(readings.flatMap((r) => r.bars))].sort((a, b) => a - b),
    });
    sides.set(midi, {
      same: readings.filter((r) => Math.sign(r.cents) === Math.sign(cents)).length,
      of: readings.length,
    });
  }
  if (pooled.length === 0) return null;

  const marks = noteMarks(pooled, newest);
  // Named only where it held: a note off on average but not in most takes is
  // drawn where it pooled and left out of the sentence.
  const held = marks.map((m) => {
    const side = sides.get(m.midi)!;
    return side.same / side.of >= SAME_SIDE ? m : { ...m, band: 'in_tune' as const };
  });
  const line = notesLine(held, 'habit') ?? 'Every note in tune';
  const named = namedMarks(held);
  return {
    marks,
    line,
    caption: named[0] ? captionFor(named[0], sides.get(named[0].midi)!) : null,
    named: named.map((m) => m.midi),
    inTuneCents: newest.inTuneCents,
  };
}

/** "Sharp in both takes", "Sharp in all 4 takes", "Flat in 5 of 7 takes". */
function captionFor(mark: NoteMark, side: { same: number; of: number }): string {
  const way = mark.cents > 0 ? 'Sharp' : 'Flat';
  if (side.same === side.of) {
    return side.of === 2 ? `${way} in both takes` : `${way} in all ${side.of} takes`;
  }
  return `${way} in ${side.same} of ${side.of} takes`;
}

/** The spelling the page used most, so an E♭ written once as D♯ stays E♭. */
function mostWritten(readings: readonly NoteIntonation[]): string {
  const count = new Map<string, number>();
  for (const r of readings) count.set(r.pitch, (count.get(r.pitch) ?? 0) + r.notes);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
