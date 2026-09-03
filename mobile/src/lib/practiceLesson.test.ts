import { describe, expect, it } from 'vitest';

import { notationSetupLesson, practiceLessonFor } from './practiceLesson';

describe('practiceLessonFor', () => {
  it('gives a first-take lesson that names the piece and working tempo', () => {
    const lesson = practiceLessonFor({
      verdict: null,
      pieceTitle: 'American in Paris',
      workingBpm: 80,
      beatUnit: 'quarter',
    });

    expect(lesson.context).toBe('Before your first take of American in Paris');
    expect(lesson.exercise).toContain('American in Paris');
    expect(lesson.exercise).toContain('80 BPM');
  });

  it('turns a rushing result into a subdivision exercise', () => {
    const lesson = practiceLessonFor({
      verdict: 'slight_rush',
      pieceTitle: 'Bottesini',
      workingBpm: 96,
      beatUnit: 'quarter',
      // Pinned, because the drill rotates by the date. The diagnosis does not.
      now: new Date(2026, 0, 1),
    });

    expect(lesson.context).toContain('latest take of Bottesini');
    expect(lesson.title).toBe('Make room between the clicks');
    expect(lesson.exercise).toContain('one-and-two-and');
  });

  it('turns a dragging result into a moving-pulse exercise', () => {
    const lesson = practiceLessonFor({
      verdict: 'dragging',
      pieceTitle: 'Koussevitzky',
      workingBpm: 72,
      beatUnit: 'quarter',
      now: new Date(2026, 0, 1),
    });

    expect(lesson.title).toBe('Carry the pulse through hard notes');
    expect(lesson.exercise).toContain('Tap steady eighth notes');
  });

  it('keeps an on-tempo follow-up comparable', () => {
    const lesson = practiceLessonFor({
      verdict: 'on_tempo',
      pieceTitle: 'Dragonetti',
      workingBpm: 60,
      beatUnit: 'half',
      now: new Date(2026, 0, 1),
    });

    expect(lesson.title).toBe('Repeat the result before adding speed');
    expect(lesson.exercise).toContain('30 half-note BPM');
    expect(lesson.exercise).toContain('before changing the tempo');
  });

  /**
   * **The card used to be identical every day.** One drill per verdict meant a
   * musician working on their rushing met the same words until they stopped —
   * and advice that never changes stops being read, on the card this app's
   * whole proposition rests on.
   *
   * What must *not* rotate is the diagnosis. "Make room between the clicks" is
   * still true tomorrow, and rewriting it to look fresh would be the app
   * pretending to know something new.
   */
  describe('the drill rotates and the diagnosis does not', () => {
    const week = Array.from({ length: 7 }, (_, day) =>
      practiceLessonFor({
        verdict: 'rushing',
        pieceTitle: 'Bottesini',
        workingBpm: 96,
        beatUnit: 'quarter',
        now: new Date(2026, 0, 1 + day),
      }),
    );

    it('keeps one heading and one reason all week', () => {
      expect(new Set(week.map((l) => l.title)).size).toBe(1);
      expect(new Set(week.map((l) => l.body)).size).toBe(1);
    });

    it('offers more than one drill across the week', () => {
      expect(new Set(week.map((l) => l.exercise)).size).toBeGreaterThan(1);
    });

    it('is the same drill all day, on every device', () => {
      // Two calls on the same date must agree — the app is closed and reopened
      // mid-session, and rerolling would discard the work already started.
      const morning = practiceLessonFor({
        verdict: 'rushing', pieceTitle: 'Bottesini', workingBpm: 96,
        beatUnit: 'quarter', now: new Date(2026, 0, 3, 9, 15),
      });
      const evening = practiceLessonFor({
        verdict: 'rushing', pieceTitle: 'Bottesini', workingBpm: 96,
        beatUnit: 'quarter', now: new Date(2026, 0, 3, 21, 40),
      });
      expect(morning.exercise).toBe(evening.exercise);
    });

    it('names the piece and the working tempo in every drill it can show', () => {
      // The reason the card cannot read like a generic article dropped onto the
      // dashboard, and the thing a new drill is most likely to forget.
      for (const verdict of ['rushing', 'slight_rush', 'dragging', 'slight_drag', 'on_tempo'] as const) {
        for (let day = 0; day < 7; day += 1) {
          const lesson = practiceLessonFor({
            verdict,
            pieceTitle: 'Bottesini',
            workingBpm: 96,
            beatUnit: 'quarter',
            now: new Date(2026, 0, 1 + day),
          });
          expect(lesson.exercise, `${verdict} day ${day}`).toContain('Bottesini');
          expect(lesson.exercise, `${verdict} day ${day}`).toContain('96 BPM');
        }
      }
    });
  });
});

describe('notationSetupLesson', () => {
  it('explains why a manual piece needs sheet music', () => {
    const lesson = notationSetupLesson('Solo No. 1', false);

    expect(lesson.context).toContain('Solo No. 1');
    expect(lesson.body).toContain('notes, rests, and repeats');
    expect(lesson.exercise).toContain('page order');
  });

  it('switches to transcription review while the pages are being read', () => {
    const lesson = notationSetupLesson('Solo No. 1', true);

    expect(lesson.context).toBe('Preparing Solo No. 1');
    expect(lesson.title).toContain('review');
    expect(lesson.exercise).toContain('highlighted measures');
  });
});
