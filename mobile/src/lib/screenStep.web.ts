/**
 * Tell `installScreenFocus.web.ts` that the screen showing has moved to a new
 * step, so it treats it as an arrival: focus goes to the step's title, or back
 * to where it was on that step.
 *
 * **Onboarding's steps were invisible to it.** They are one screen whose
 * content changes, not routes, so "Next" took focus with the step it was on
 * and left it on `<body>`: a screen reader said nothing about the question
 * that had arrived. Measured 2026-10-06 on the first five steps.
 */
export const SCREEN_STEP_EVENT = 'intempo:screen-step';

export function announceScreenStep(step: string): void {
  document.dispatchEvent(new CustomEvent<string>(SCREEN_STEP_EVENT, { detail: step }));
}
