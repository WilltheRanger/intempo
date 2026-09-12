import { useState } from 'react';

import { SignUpOnboardingScreen } from '../onboarding/SignUpOnboardingScreen';
import { AuthScreen } from './AuthScreen';
import type { AuthMode } from './authErrors';

/** Which half of creating an account is on screen. */
type Step = 'auth' | 'onboarding';

/**
 * Everything a signed-out musician sees.
 *
 * Two screens rather than one, because onboarding comes **before** sign-up as
 * of 2026-09-08: tapping *Create an account* asks who is playing first, and
 * Continue lands on the account form with the answers already kept.
 *
 * **Signing in is untouched.** Someone who already has an account never sees
 * onboarding here — they have answered it, or the post-sign-in gate will ask.
 * That is the whole reason this is a step in front of the sign-up form and not
 * a screen in front of `AuthScreen`.
 *
 * The state is two fields and no rules: what can be got wrong about onboarding
 * lives in `lib/onboarding.ts` where it is tested, and what can be got wrong
 * about the answers lives in `data/onboardingDraft.ts` where it is tested.
 * Switching steps remounts `AuthScreen`, which is why `initialMode` is read
 * once — coming back from onboarding should land on the account form, not on
 * the sign-in one with a switch still to make.
 */
export function SignedOutFlow() {
  const [step, setStep] = useState<Step>('auth');
  const [mode, setMode] = useState<AuthMode>('signIn');

  function goToAuth(next: AuthMode) {
    setMode(next);
    setStep('auth');
  }

  if (step === 'onboarding') {
    return (
      <SignUpOnboardingScreen
        onContinue={() => goToAuth('signUp')}
        onSignInInstead={() => goToAuth('signIn')}
      />
    );
  }

  return (
    <AuthScreen
      initialMode={mode}
      onRequestSignUp={() => setStep('onboarding')}
    />
  );
}
