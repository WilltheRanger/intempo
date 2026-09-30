import { describe, expect, it } from 'vitest';

import type { NoteIntonation, TakeResult } from '../../data/types';
import { notesHabitFrom } from './notesHabit';

function note(pitch: string, midi: number, cents: number, notes: number, bars = [1]): NoteIntonation {
  return { pitch, midi, cents, notes, bars };
}

/** Newest first, as `getRecentTakes` returns them. */
function takes(...byNote: NoteIntonation[][]): TakeResult[] {
  return byNote.map(
    (notes, index) =>
      ({
        id: `take-${index}`,
        recordedAt: new Date(Date.UTC(2026, 8, 30 - index)).toISOString(),
        failure: null,
        status: 'ok',
        intonation: {
          tuningCents: 0,
          spreadCents: 15,
          notes: 60,
          inTuneCents: 15,
          slightCents: 30,
          tuningWorthSayingCents: 10,
          byNote: notes,
          byNoteShowNotes: 4,
        },
      }) as unknown as TakeResult,
  );
}

/** The owner's two bass takes, 2026-09-30, newest first. */
const TAKE_1940 = [
  note('G2', 43, -27.1, 3, [2, 15, 22]),
  note('A2', 45, -13.2, 4),
  note('Bb2', 46, 9.6, 3),
  note('C3', 48, -11.7, 7),
  note('D3', 50, 1.7, 11),
  note('Eb3', 51, 16.9, 8, [1, 3, 4, 6, 8, 10, 18]),
  note('F3', 53, -3.3, 9),
  note('G3', 55, 15.6, 6),
];
const TAKE_0313 = [
  note('A2', 45, 0.2, 3),
  note('Bb2', 46, 31.7, 4),
  note('C3', 48, 13.6, 8),
  note('D3', 50, 0.6, 7),
  note('Eb3', 51, 20.1, 3, [1, 3, 6]),
  note('F3', 53, -0.4, 11),
  note('G3', 55, -10.9, 5),
];

describe('notesHabitFrom', () => {
  it("names the owner's B♭s and E♭s, sharp in both takes", () => {
    const habit = notesHabitFrom(takes(TAKE_1940, TAKE_0313))!;

    expect(habit.line).toBe('Your B♭s and E♭s run sharp');
    expect(habit.caption).toBe('Sharp in both takes');
    expect(habit.named).toEqual([46, 51]);
  });

  it('pools each note by how often each take read it', () => {
    const habit = notesHabitFrom(takes(TAKE_1940, TAKE_0313))!;
    const eb = habit.marks.find((m) => m.name === 'E♭')!;

    // (16.9 × 8 + 20.1 × 3) / 11
    expect(eb.cents).toBeCloseTo(17.8, 1);
    expect(eb.notes).toBe(11);
    expect(eb.bars).toEqual([1, 3, 4, 6, 8, 10, 18]);
  });

  it('pools a note sharp in one take and flat in the other to where it sits together', () => {
    const habit = notesHabitFrom(takes(TAKE_1940, TAKE_0313))!;
    const g = habit.marks.find((m) => m.midi === 55)!;

    expect(Math.abs(g.cents)).toBeLessThan(15);
    expect(g.band).toBe('in_tune');
  });

  it('leaves out a note only one take played', () => {
    const habit = notesHabitFrom(takes(TAKE_1940, TAKE_0313))!;

    expect(habit.marks.some((m) => m.midi === 43)).toBe(false);
  });

  it('draws a note off on average but does not name it unless most takes agree', () => {
    const habit = notesHabitFrom(
      takes([note('C3', 48, 60, 6)], [note('C3', 48, -5, 4)], [note('C3', 48, -5, 4)]),
    )!;

    expect(habit.marks[0].band).not.toBe('in_tune');
    expect(habit.line).toBe('Every note in tune');
    expect(habit.caption).toBeNull();
  });

  it('counts the takes that agreed', () => {
    const habit = notesHabitFrom(
      takes([note('C3', 48, -25, 5)], [note('C3', 48, -30, 5)], [note('C3', 48, 5, 5)]),
    )!;

    expect(habit.line).toBe('Your Cs run flat');
    expect(habit.caption).toBe('Flat in 2 of 3 takes');
  });

  it('says all of them when every take agreed', () => {
    const three = [note('D3', 50, 20, 4)];

    expect(notesHabitFrom(takes(three, three, three))!.caption).toBe('Sharp in all 3 takes');
  });

  it('needs two takes read by note', () => {
    expect(notesHabitFrom(takes(TAKE_1940))).toBeNull();
    expect(notesHabitFrom(takes(TAKE_1940, []))).toBeNull();
  });

  it('keeps the spelling the page used most', () => {
    const habit = notesHabitFrom(takes([note('Eb3', 51, 20, 6)], [note('D#3', 51, 20, 2)]))!;

    expect(habit.marks[0].name).toBe('E♭');
  });
});
