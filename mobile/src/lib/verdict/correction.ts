import type { MeasureVerdict, UserVerdict } from '../../data/types';
import { readMeasure } from './measureReading';

/**
 * Telling the app it got a bar wrong.
 *
 * `POST /v1/analyses/:id/corrections` has existed, tested and owner-scoped,
 * since Batch 8, and no client has ever called it. Its own docstring says what
 * that costs:
 *
 * > They are also the only route out of the position Batch 3 is currently
 * > stuck in. Its thresholds are the spec's starting values, untuned, because
 * > tuning needs a human ear on real recordings.
 *
 * So `verdict_corrections` has been empty for every account, by construction,
 * while `TUNING_LOG.md` recorded the thresholds as awaiting exactly the ears
 * this table was built to collect.
 *
 * The rules live here rather than in the screen because there is no React
 * Native testing library in this repository (`DECISIONS.md`, 2026-08-24) — a
 * rule inside a `.tsx` is a rule nothing checks.
 */

/**
 * The three things a musician can say happened, in the order they are offered.
 *
 * Deliberately not `Verdict`, `Band` or `Direction`. Those are the *app's*
 * vocabulary, with four bands and a severity — and a musician disagreeing with
 * a bar is not adjudicating between "slight rush" and "rushing", they are
 * saying it rushed or it did not. `unsure` is the fourth option and is offered
 * separately, because the spec warns that many corrections will come from
 * people disagreeing with the concept rather than catching a misfire, and
 * someone who genuinely cannot remember is more useful in the data than
 * someone who guessed.
 */
export const CORRECTION_CHOICES: readonly UserVerdict[] = [
  'on_tempo',
  'rushing',
  'dragging',
] as const;

/** The word each choice shows. Sentence case, matching the verdict column. */
const CHOICE_WORDS: Record<UserVerdict, string> = {
  on_tempo: 'On tempo',
  rushing: 'Rushing',
  dragging: 'Dragging',
  unsure: 'Not sure',
};

export function correctionWord(choice: UserVerdict): string {
  return CHOICE_WORDS[choice];
}

/**
 * Whether this bar can be corrected at all.
 *
 * **The same predicate the row already uses to decide whether a tap reveals
 * anything**, deliberately, rather than a second rule that could disagree with
 * it. A bar under a written `rit.`, a held fermata or an ornament made no
 * claim about the playing — the app declined to judge it — so there is nothing
 * to agree or disagree with, and offering the question would ask a musician to
 * adjudicate a measurement that was never made.
 */
export function canCorrect(measure: MeasureVerdict): boolean {
  return readMeasure(measure).revealsFigure;
}

/**
 * What the app said about this bar, in the musician's vocabulary.
 *
 * This is the value pre-selected in the control, so the musician changes an
 * answer rather than supplying one from nothing — and it is what gets sent as
 * `app_verdict`, so the pair is stored together. Without the pair the dataset
 * cannot say what was corrected, only what somebody thought, which is the
 * comparison the whole table exists to make.
 *
 * Collapses the four bands onto three words: `slight`, `rush_drag` and
 * `severe` all mean "it rushed" or "it dragged" to the person who played it.
 * The band itself is not lost — the server stores the take's own
 * `result_json`, thresholds included, so how far off it was remains
 * recoverable from the analysis this correction names.
 */
export function appVerdictFor(measure: MeasureVerdict): UserVerdict {
  if (measure.band === 'on' || measure.direction === 'on') {
    return 'on_tempo';
  }
  return measure.direction === 'rush' ? 'rushing' : 'dragging';
}

/**
 * What to say once it has been sent.
 *
 * Deliberately not "Thanks" or a tick that implies the verdict changed. The
 * bar still reads what it read: this is a note to whoever tunes the
 * thresholds, not an edit to the take. Saying otherwise would be the app
 * pretending to have learned something in the two seconds since the tap.
 */
export function correctionAcknowledgement(choice: UserVerdict): string {
  return choice === 'unsure'
    ? 'Thanks.'
    : `Noted as ${correctionWord(choice).toLowerCase()}.`;
}
