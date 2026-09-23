import { onboardingDraft, useOnboardingDraft } from '../../data/onboardingDraft';
import { OnboardingFlow } from './OnboardingFlow';

export interface SignUpOnboardingScreenProps {
  /** The answers are kept; show the form that creates the account. */
  onContinue: () => void;
  /** They meant to sign in. Nothing is discarded — see below. */
  onSignInInstead: () => void;
}

/**
 * The questions, asked before there is an account to put them on.
 *
 * The owner's call on 2026-09-08: onboarding comes **before** sign-up. Someone
 * who has decided to try InTempo answers who they are and what they play, and
 * only then is asked for an email and a password — rather than handing over
 * credentials to a product that has not yet asked them anything. The redesign
 * keeps that order: "Create an account" opens its Welcome, and its Welcome
 * offers "I already have an account".
 *
 * ## What happens to the answers
 *
 * The name, instrument and photograph go to `onboardingDraft`, on the device,
 * because there is nowhere else for them to go: creating an account usually
 * returns **no session** — Supabase emails a confirmation link, and the
 * musician leaves for their inbox. `useApplyOnboardingDraft` sends them the
 * moment a session appears. The role and "how did you find us" are device
 * preferences and are already kept by the time this screen hears of them.
 *
 * The photograph is the part that does not survive the app being relaunched,
 * deliberately (`OnboardingDraft.photo`) — and since 2026-09-23 it is
 * optional, so losing it costs a picture and no longer a second trip through
 * the questions.
 *
 * ## The way out
 *
 * "I already have an account" on the Welcome. It does **not** clear the draft:
 * signing in on a device where somebody had started answering is not a reason
 * to throw the answers away — and if that account is already onboarded,
 * nothing is ever sent. `signOut` clears it, which is the point where a draft
 * could reach the wrong account.
 */
export function SignUpOnboardingScreen({
  onContinue,
  onSignInInstead,
}: SignUpOnboardingScreenProps) {
  const draft = useOnboardingDraft();

  return (
    <OnboardingFlow
      initial={draft}
      finishLabel="Next"
      onHaveAccount={(answers) => {
        // Kept on the way out too. Someone who typed their name and then
        // realised they already have an account should not find the field
        // empty when they come back.
        onboardingDraft.set(answers);
        onSignInInstead();
      }}
      onFinish={(answers) => {
        onboardingDraft.set(answers);
        onContinue();
      }}
    />
  );
}
