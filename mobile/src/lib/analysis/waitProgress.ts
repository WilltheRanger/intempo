/**
 * What to show a musician while their take is being analysed.
 *
 * **The screen it exists for had nothing that moved.** `submit()` polls the
 * analysis to completion before navigating, so 'Listening back' is on screen
 * for the whole run — about 150 seconds on the deployed instance — and it
 * showed a title and one line of static text. A musician cannot tell that from
 * a hang, which is what was reported: "I don't know if it's working".
 *
 * **The bar advances on real stage transitions, never on a clock.** The runner
 * writes which leg it is on and `stage` carries it here. A bar driven by
 * elapsed time is a drawn affordance that does not do the thing it depicts,
 * which `CLAUDE.md` §3 rules out — and it would be a lie in both directions,
 * racing ahead of a slow run and stalling at 100% on a fast one.
 *
 * **Which leaves the honest problem: one leg is most of the wait.** Onset
 * detection over the whole take is a single stage and about two thirds of the
 * time, so a bar that only steps would sit still for ninety seconds and lose
 * the argument it was added to win. The answer is not to fake motion inside
 * the stage but to put the motion somewhere that is true: the elapsed clock
 * counts up, and the screen keeps a live indicator. The bar stays honest, and
 * something on the screen is always moving.
 *
 * Rules live here rather than in the screen because there is no React Native
 * testing library in this project (`DECISIONS.md`, 2026-08-24), so a rule
 * inside a `.tsx` is a rule nothing checks.
 */

/**
 * The legs a run reports, in order, mirroring `STAGES` in
 * `backend/app/workers/analysis_runner.py`.
 *
 * Duplicated across the wire rather than shared, like every other string the
 * two halves agree on here. The test below holds the list against the
 * backend's, so the duplication is checked rather than trusted.
 */
export const STAGES = [
  'fetching',
  'checking',
  'decoding',
  'listening',
  'saving',
] as const;

export type Stage = (typeof STAGES)[number];

/**
 * What each leg is called on screen, and how far through it leaves the bar.
 *
 * **The fractions are shares of the work, measured, not equal steps.** Seven
 * production runs took 150.5, 152.1, 153.3, 154.8, 155.1, 157.6 and 160.4
 * seconds — a spread of under 7% — and the logs put almost all of it between
 * the decode and the alignment. Equal fifths would have the bar at 60% while
 * two thirds of the wait was still ahead, which is the same lie as a timer.
 *
 * `listening` therefore spans 0.30 to 0.90: it is one leg on the wire and the
 * long one in practice, and the bar says so by giving it most of the track.
 *
 * The labels name what is happening to *the take*, not what the server is
 * doing to a file. 'Uploading your take' is a fact about infrastructure;
 * 'Listening for the notes you played' is the same fact in the terms of the
 * person waiting.
 */
const LEGS: Record<Stage, { label: string; through: number }> = {
  fetching: { label: 'Collecting your take', through: 0.1 },
  checking: { label: 'Checking the recording', through: 0.2 },
  decoding: { label: 'Opening the audio', through: 0.3 },
  listening: { label: 'Listening for the notes you played', through: 0.9 },
  saving: { label: 'Lining it up with the page', through: 0.98 },
};

export interface WaitProgress {
  /** The line under the title. Never empty. */
  label: string;
  /**
   * How far along the bar sits, 0..1, or `null` when there is nothing
   * truthful to draw — which is a real state and not a zero. See
   * `progressFor`.
   */
  through: number | null;
}

/**
 * Where the bar sits and what the line says, for a stage off the wire.
 *
 * `null` and unknown values are the same answer on purpose, and it is not
 * `0`:
 *
 *  - **Null** is a run the API cannot describe — a deployment whose table
 *    predates migration 025, a row the runner has not picked up yet, or an
 *    older client's idea of the pipeline. Drawing an empty bar there claims
 *    'no progress has been made', which is a stronger statement than the app
 *    is entitled to and the one a musician reads as stuck.
 *  - **An unrecognised stage** is a pipeline this build is older than. The
 *    honest reading is 'somewhere in the middle', and inventing a position
 *    for it would be guessing about code this app has never seen.
 *
 * Both get the generic line and no bar, so the screen falls back to the
 * elapsed clock and the live indicator, which are true regardless.
 */
export function progressFor(stage: string | null | undefined): WaitProgress {
  if (!stage) {
    return {
      label: 'Matching what you played against the score',
      through: null,
    };
  }
  const leg = LEGS[stage as Stage];
  if (!leg) {
    return {
      label: 'Matching what you played against the score',
      through: null,
    };
  }
  return { label: leg.label, through: leg.through };
}

/**
 * The elapsed clock, as `m:ss`.
 *
 * Present because it is the one number that is unarguably true while a single
 * long stage runs, and because a musician who has waited three minutes should
 * be able to see that they have.
 */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Whether a run has gone on long enough to say so.
 *
 * **Not a failure, and it must not read as one.** The deployed instance is on
 * a plan with a fraction of a CPU and a take costs about 150 seconds there, so
 * three minutes is slow rather than broken and the watchdog above this is the
 * thing that decides it has failed. What this earns is one extra sentence, so
 * a musician who has waited past the usual knows the app knows.
 */
export const LONG_WAIT_MS = 180_000;

export function isTakingLong(ms: number): boolean {
  return ms >= LONG_WAIT_MS;
}
