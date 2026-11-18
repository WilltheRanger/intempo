import type { Instrument } from '../data/types';

/**
 * The redesign's onboarding, one question a screen (`redesign/Onboard*.dc.html`):
 * the order, what each step needs before Next, and the choices two of them
 * offer. A rules module because a rule in a `.tsx` is a rule nothing checks.
 *
 * "How InTempo works" and Welcome come before the first step and Done after
 * the last; none is a question, so none is on the progress bar, and the
 * Welcome counts these to say how many questions there are.
 *
 * **Three, where there were six** (the owner, 2026-11-12, reversing
 * 2026-09-23). The microphone moved to the first take, where it is used and
 * where its explanation can come straight before the system's question
 * (`MicrophoneIntro`); "how did you find us" and the profile photo went, as
 * two answers nothing in the app reads. Name and instrument are what the
 * account needs, and the role is kept for the teacher tier.
 */
export const ONBOARDING_STEPS = ['name', 'instrument', 'role'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Whether the musician is learning or teaching.
 *
 * **Kept on the device, not sent.** `PATCH /v1/me` cannot set a role — every
 * account is created a student — and the teacher tier it would switch on is
 * Batch 12's. The owner's call on 2026-09-23: build the question as designed
 * and remember the answer here until that exists.
 */
export type PracticeRole = 'learning' | 'teaching';

/**
 * Where the musician heard of the app. Asked in onboarding until 2026-11-12;
 * an answer already on a device is still read and kept (`preferences`).
 */
export type FoundVia = 'teacher' | 'friend' | 'youtube' | 'appStore' | 'reddit' | 'elsewhere';

export interface StepAnswers {
  name: string;
  instrument: Instrument | null;
  role: PracticeRole | null;
}

/**
 * The two answers, as titles alone — the owner, 2026-09-30, of the line that
 * sat under each ("Only you see your takes", "Follow your students’
 * practice"): "Its everywhere, and its over explaining".
 */
export const ROLE_CHOICES: ReadonlyArray<{ value: PracticeRole; title: string }> = [
  { value: 'learning', title: 'I’m learning' },
  { value: 'teaching', title: 'I teach' },
];

export const FOUND_VIA_CHOICES: ReadonlyArray<{ value: FoundVia; label: string }> = [
  { value: 'teacher', label: 'My teacher' },
  { value: 'friend', label: 'A friend' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'appStore', label: 'The App Store' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'elsewhere', label: 'Somewhere else' },
];

/**
 * Whether Next is open on a step.
 *
 * The name and the instrument are the two answers onboarding requires
 * (`missingFromOnboarding`), so their steps wait for them, and the role waits
 * for one of its two answers (nothing is chosen for the musician, 2026-09-29).
 */
export function canContinue(step: OnboardingStep, answers: StepAnswers): boolean {
  switch (step) {
    case 'name':
      return answers.name.trim().length > 0;
    case 'instrument':
      return answers.instrument !== null;
    case 'role':
      return answers.role !== null;
    default:
      return true;
  }
}

/** 1 to 3: how many segments of the progress bar are filled on this step. */
export function stepNumber(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

/** The step after this one, or null after the last. */
export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? null;
}

/** The step before this one, or null before the first (which is Welcome). */
export function previousStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) - 1] ?? null;
}
