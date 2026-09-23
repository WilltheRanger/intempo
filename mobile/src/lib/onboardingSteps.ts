import type { Instrument } from '../data/types';

/**
 * The redesign's onboarding, one question a screen (`redesign/Onboard*.dc.html`):
 * the order, what each step needs before Next, and the choices two of them
 * offer. A rules module because a rule in a `.tsx` is a rule nothing checks.
 *
 * Welcome comes before the first step and Done after the last; neither is a
 * question, so neither is on the progress bar — which is why the bar has six
 * segments and the Welcome says "six quick questions".
 */
export const ONBOARDING_STEPS = [
  'name',
  'instrument',
  'role',
  'microphone',
  'source',
  'photo',
] as const;

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

/** Where the musician heard of the app. Kept on the device; nothing reads it yet. */
export type FoundVia = 'teacher' | 'friend' | 'youtube' | 'appStore' | 'reddit' | 'elsewhere';

export interface StepAnswers {
  name: string;
  instrument: Instrument | null;
  role: PracticeRole | null;
  source: FoundVia | null;
}

export const ROLE_CHOICES: ReadonlyArray<{ value: PracticeRole; title: string; detail: string }> = [
  { value: 'learning', title: "I'm learning", detail: 'Personal (No one sees your takes)' },
  {
    value: 'teaching',
    title: 'I teach',
    detail: "Set up a studio and follow your students' practice.",
  },
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
 * (`missingFromOnboarding`), so their steps wait for them. The role is a choice
 * between two, and one is always made. The microphone has its own two buttons,
 * "how did you find us" can be skipped, and the photo is optional — so those
 * never hold Next shut.
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

/** 1 to 6: how many segments of the progress bar are filled on this step. */
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
