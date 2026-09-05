import type { TempoBeatUnit, Verdict } from '../data/types';
import { formatTempo } from './tempo';
import { dayIndex } from './warmup';

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
  /** Which day's drill to show. Injected so the rotation can be tested. */
  now?: Date;
}

/**
 * One of the day's drills for a diagnosis that has not changed.
 *
 * **The heading and the reason stay put; only the drill moves.** They are still
 * true for as long as the musician is still rushing, and rewriting a correct
 * diagnosis to look fresh would be the app pretending to know something new.
 * What went stale was the *exercise*: one per verdict meant someone working on
 * their rushing met the identical card, word for word, every day until they
 * stopped — and advice that never changes stops being read, on the card this
 * app's whole proposition rests on.
 *
 * By the date, not at random, for the reason `warmupFor` rotates that way: it
 * has to be the same drill all day and the same on every device, or closing the
 * app would reroll the work you had already started.
 */
function drillOfTheDay(drills: string[], now: Date): string {
  return drills[dayIndex(now) % drills.length];
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
  now = new Date(),
}: PracticeLessonInput): PracticeLesson {
  const tempo = formatTempo(workingBpm, beatUnit);
  const latestTake = `Based on your latest take of ${pieceTitle}`;

  if (verdict === 'rushing' || verdict === 'slight_rush') {
    return {
      context: latestTake,
      title: 'Make room between the clicks',
      body:
        'Rushing often starts in the space between beats. Subdivide before you play so the next note has somewhere exact to land.',
      exercise: drillOfTheDay(
        [
          `Keep ${pieceTitle} at ${tempo}. Count “one-and-two-and” through one phrase, then play it again without counting aloud.`,
          `Set the metronome to ${tempo}. Clap the rhythm of one phrase of ${pieceTitle}, then play the same phrase. Keep counting through the rests instead of arriving early at the next note.`,
          `Play the hardest bar of ${pieceTitle} at ${tempo}, holding the last note of the bar its full length before moving on. Rushing usually starts by leaving a note early, not by playing the next one fast.`,
        ],
        now,
      ),
    };
  }

  if (verdict === 'dragging' || verdict === 'slight_drag') {
    return {
      context: latestTake,
      title: 'Carry the pulse through hard notes',
      body:
        'Dragging often begins when the hands wait for the beat before preparing. Let the subdivision keep moving while you set up the next note.',
      exercise: drillOfTheDay(
        [
          `Keep ${pieceTitle} at ${tempo}. Tap steady eighth notes through the hardest phrase, then play while carrying that motion internally.`,
          `At ${tempo}, play one phrase of ${pieceTitle} and prepare each note during the note before it — fingers down, bow placed — so nothing waits for the beat to arrive.`,
          `Play the phrase of ${pieceTitle} that drags at ${tempo}, then again one notch faster, then back. The faster pass is not the goal; it is what stops the slower one feeling like the ceiling.`,
        ],
        now,
      ),
    };
  }

  if (verdict === 'on_tempo') {
    return {
      context: latestTake,
      title: 'Repeat the result before adding speed',
      body:
        'One steady take is a good sign. A second comparable take shows whether the pulse is dependable rather than accidental.',
      exercise: drillOfTheDay(
        [
          `Record ${pieceTitle} once more at ${tempo} before changing the tempo. Aim to reproduce the same pulse.`,
          `Record ${pieceTitle} at ${tempo} with the metronome off. Holding the pulse without it is the test of whether it is yours yet.`,
          `Record ${pieceTitle} at ${tempo} starting from a later bar rather than the beginning. A pulse that only holds from bar 1 is the opening you have practised, not the piece.`,
        ],
        now,
      ),
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
