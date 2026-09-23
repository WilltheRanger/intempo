import { adviceFor, MIN_PAGE_ROWS, type Legibility } from './legibility';

/**
 * What to say about a photograph, the moment it is taken.
 *
 * **The Verdict on the Shot frame.** The measurement already existed —
 * `legibilityOf` counts the staff spacing in the real pixels of the real page —
 * and it was spent on a single line of advice that appeared only when the page
 * was too small to read. Everything else got silence, which reads as approval
 * and sometimes was not.
 *
 * Judging it here costs the musician a tap while they are still standing at the
 * stand with the page in front of them. Not judging it costs a failed
 * transcription, discovered three screens and several minutes later, by which
 * point the page has been put away. That is the trade this makes, and it is the
 * frame's whole argument.
 *
 * **`unknown` is not a bad page.** `legibility.ts` is explicit that nothing
 * measurable means the *measurement* failed, not the photograph, and that it
 * must say nothing rather than warn. That rule is kept: an unmeasured page gets
 * a neutral verdict, never a warning.
 */

export type ShotTone = 'good' | 'doubtful';

export interface ShotVerdict {
  tone: ShotTone;
  /** The finding, in a musician's terms. */
  headline: string;
  /** Why, and what would change it. */
  body: string;
  /** The label on the action that keeps this page. */
  keepLabel: string;
  /** The label on the action that shoots it again. */
  retakeLabel: string;
  /**
   * Which of the two the musician is being steered towards.
   *
   * It flips: on a page that reads, keeping it is the whole point and a retake
   * is the escape hatch; on one that does not, the retake is the advice and
   * keeping it is the exception. The screen draws whichever this names as the
   * filled control, so that decision is made here where a test can see it
   * rather than in a `.tsx` where nothing can.
   */
  primary: 'keep' | 'retake';
  /**
   * Where a retake should go.
   *
   * `cameraApp` when no amount of moving closer would help, which is a real
   * distinction `adviceFor` already draws: a page shot from across a desk has
   * plenty of pixels and too little page in them, and a page shot through a
   * capped stream has filled the frame already and still has too few.
   */
  retake: 'retake' | 'cameraApp';
}

export function shotVerdict(
  legibility: Legibility,
  pageRows?: number,
): ShotVerdict {
  const advice = adviceFor(legibility, pageRows);

  if (advice) {
    const cannotHelp = advice.route === 'cameraApp';
    return {
      tone: 'doubtful',
      // Both strings come from `adviceFor` rather than being paraphrased here.
      // This used to write its own headline beside `advice.message`, and the
      // two said the same sentence twice — see `Advice.headline`.
      headline: advice.headline,
      body: advice.body,
      // Named for what it costs rather than for what it does. "Keep it" on a
      // page the app has just said it cannot read is an invitation without a
      // warning; this one says what the musician is choosing.
      keepLabel: 'Use it anyway',
      retakeLabel: cannotHelp ? 'Open the camera app' : 'Take this page again',
      primary: 'retake',
      retake: advice.route,
    };
  }

  if (legibility.verdict === 'unknown') {
    return {
      tone: 'good',
      headline: 'Page captured',
      // Stated without the negation it used to carry. It read "rather than a
      // bad photograph", and a musician skimming a reassurance sees the word
      // "bad" next to their page. The test holds this.
      body: 'It will be read with the rest.',
      keepLabel: 'Keep it',
      retakeLabel: 'Take it again',
      primary: 'keep',
      retake: 'retake',
    };
  }

  return {
    tone: 'good',
    headline: 'The notes are clear',
    body: 'Clear enough to read.',
    keepLabel: 'Keep it',
    retakeLabel: 'Take it again',
    primary: 'keep',
    retake: 'retake',
  };
}

/**
 * What to tell the next shot, based on the last one.
 *
 * The Guided frame asks for live feedback on the page in the viewfinder, and
 * this app cannot honestly give that: reading tilt and shadow off a live
 * preview needs a frame processor `expo-camera` does not expose, and sampling
 * by taking hidden photographs would cost more than it saves.
 *
 * What it *can* do is stop repeating generic advice. A musician who has just
 * had a page come back too small is told to move in; one whose last page read
 * well is told it did. The guidance is specific because it is measured, which
 * is the part of the frame that was actually available.
 */
export function viewfinderGuide(last: ShotVerdict | null): string {
  if (!last) {
    return 'Fill the frame · flat · no shadows';
  }
  if (last.tone === 'good') {
    return 'Same distance again';
  }
  return last.retake === 'cameraApp'
    ? 'Try the camera app'
    : 'Move closer'
}

/** Re-exported so a screen can name the floor without importing two modules. */
export { MIN_PAGE_ROWS };
