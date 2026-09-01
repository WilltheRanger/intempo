import { describe, expect, it } from 'vitest';

import { practiceLessonFor } from './practiceLesson';

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
    });

    expect(lesson.title).toBe('Repeat the result before adding speed');
    expect(lesson.exercise).toContain('30 half-note BPM');
    expect(lesson.exercise).toContain('before changing the tempo');
  });
});
