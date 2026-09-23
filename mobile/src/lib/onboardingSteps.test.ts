import { describe, expect, it } from 'vitest';

import {
  canContinue,
  FOUND_VIA_CHOICES,
  nextStep,
  ONBOARDING_STEPS,
  previousStep,
  ROLE_CHOICES,
  stepNumber,
  type StepAnswers,
} from './onboardingSteps';

const EMPTY: StepAnswers = { name: '', instrument: null, role: null, source: null };

describe('the onboarding steps', () => {
  it('are the six questions the Welcome promises, in order', () => {
    expect(ONBOARDING_STEPS).toEqual([
      'name',
      'instrument',
      'role',
      'microphone',
      'source',
      'photo',
    ]);
  });

  it('fill the progress bar one segment a step', () => {
    expect(ONBOARDING_STEPS.map(stepNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('walk forward to the end and back to the start', () => {
    expect(nextStep('name')).toBe('instrument');
    expect(nextStep('photo')).toBeNull();
    expect(previousStep('instrument')).toBe('name');
    expect(previousStep('name')).toBeNull();
  });
});

describe('when Next is open', () => {
  it('waits for a name, and a name of spaces is not one', () => {
    expect(canContinue('name', EMPTY)).toBe(false);
    expect(canContinue('name', { ...EMPTY, name: '   ' })).toBe(false);
    expect(canContinue('name', { ...EMPTY, name: 'Arya' })).toBe(true);
  });

  it('waits for an instrument and a role', () => {
    expect(canContinue('instrument', EMPTY)).toBe(false);
    expect(canContinue('instrument', { ...EMPTY, instrument: 'cello' })).toBe(true);
    expect(canContinue('role', EMPTY)).toBe(false);
    expect(canContinue('role', { ...EMPTY, role: 'learning' })).toBe(true);
  });

  it('never holds the optional steps shut', () => {
    for (const step of ['microphone', 'source', 'photo'] as const) {
      expect(canContinue(step, EMPTY)).toBe(true);
    }
  });
});

describe('the choices', () => {
  it('offers both roles and six places, each once', () => {
    expect(ROLE_CHOICES.map((choice) => choice.value)).toEqual(['learning', 'teaching']);
    const places = FOUND_VIA_CHOICES.map((choice) => choice.value);
    expect(new Set(places).size).toBe(6);
  });
});
