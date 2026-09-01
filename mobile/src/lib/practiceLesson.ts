import type { TempoBeatUnit, Verdict } from '../data/types';
import { formatTempo } from './tempo';

export interface PracticeLesson {
  context: string;
  title: string;
  body: string;
  exercise: string;
}

interface PracticeLessonInput {
  verdict: Verdict | null;
  pieceTitle: string;
  workingBpm: number;
  beatUnit?: TempoBeatUnit | null;
}

/**
 * Turn the latest result into one small, playable lesson.
 *
 * The coaching names both the piece and the working tempo so it cannot read
 * like a generic article dropped onto the dashboard. A musician with no take
 * receives a baseline exercise; once a result exists, the exercise follows
 * the timing tendency the analysis actually reported.
 */
export function practiceLessonFor({
  verdict,
  pieceTitle,
  workingBpm,
  beatUnit,
}: PracticeLessonInput): PracticeLesson {
  const tempo = formatTempo(workingBpm, beatUnit);
  const latestTake = `Based on your latest take of ${pieceTitle}`;

  if (verdict === 'rushing' || verdict === 'slight_rush') {
    return {
      context: latestTake,
      title: 'Make room between the clicks',
      body:
        'Rushing often starts in the space between beats. Subdivide before you play so the next note has somewhere exact to land.',
      exercise:
        `Keep ${pieceTitle} at ${tempo}. Count “one-and-two-and” through one phrase, then play it again without counting aloud.`,
    };
  }

  if (verdict === 'dragging' || verdict === 'slight_drag') {
    return {
      context: latestTake,
      title: 'Carry the pulse through hard notes',
      body:
        'Dragging often begins when the hands wait for the beat before preparing. Let the subdivision keep moving while you set up the next note.',
      exercise:
        `Keep ${pieceTitle} at ${tempo}. Tap steady eighth notes through the hardest phrase, then play while carrying that motion internally.`,
    };
  }

  if (verdict === 'on_tempo') {
    return {
      context: latestTake,
      title: 'Repeat the result before adding speed',
      body:
        'One steady take is a good sign. A second comparable take shows whether the pulse is dependable rather than accidental.',
      exercise:
        `Record ${pieceTitle} once more at ${tempo} before changing the tempo. Aim to reproduce the same pulse.`,
    };
  }

  return {
    context: `Before your first take of ${pieceTitle}`,
    title: 'Start with an honest baseline',
    body:
      'A useful first take is not your fastest attempt. Choose a tempo where you can keep moving after a mistake and hear what your timing normally does.',
    exercise:
      `Start ${pieceTitle} at ${tempo} and record one uninterrupted take. Do not restart—use it as the starting point.`,
  };
}

/** Contextual setup lesson shown while a piece has no readable notation yet. */
export function notationSetupLesson(
  pieceTitle: string,
  reading: boolean,
): PracticeLesson {
  return reading
    ? {
        context: `Preparing ${pieceTitle}`,
        title: 'Keep the page open for review',
        body:
          'When the reading finishes, compare the digital notation with the original pages before recording.',
        exercise:
          'Review any highlighted measures, correct them, and accept the transcription when it matches the page.',
      }
    : {
        context: `Before practising ${pieceTitle}`,
        title: 'Give the recording something to follow',
        body:
          'Timing feedback is only meaningful when InTempo knows the written notes, rests, and repeats.',
        exercise:
          'Photograph or import the complete part in page order. Check the transcription before your first take.',
      };
}
