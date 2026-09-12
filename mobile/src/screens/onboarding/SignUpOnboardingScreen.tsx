import { Pressable, StyleSheet } from 'react-native';

import { Text } from '../../components/primitives';
import { onboardingDraft, useOnboardingDraft } from '../../data/onboardingDraft';
import { MIN_TOUCH_TARGET, spacing } from '../../design';
import { OnboardingForm } from './OnboardingForm';

export interface SignUpOnboardingScreenProps {
  /** The answers are kept; show the form that creates the account. */
  onContinue: () => void;
  /** They meant to sign in. Nothing is discarded — see below. */
  onSignInInstead: () => void;
}

/**
 * The three questions, asked before there is an account to put them on.
 *
 * The owner's call on 2026-09-08: onboarding comes **before** sign-up. Someone
 * who has decided to try InTempo answers who they are and what they play, and
 * only then is asked for an email and a password — rather than handing over
 * credentials to a product that has not yet asked them anything.
 *
 * ## What happens to the answers
 *
 * They go to `onboardingDraft`, on the device, because there is nowhere else
 * for them to go: creating an account usually returns **no session** — Supabase
 * emails a confirmation link, and the musician leaves for their inbox.
 * `useApplyOnboardingDraft` sends them the moment a session appears.
 *
 * The photograph is the part that does not survive the app being relaunched,
 * deliberately (`OnboardingDraft.photo`). The name and instrument do, they
 * reach the account, and the post-sign-in gate then opens with those two
 * filled and asks only for the picture.
 *
 * ## The way out
 *
 * "Already have an account? Sign in" sits under Continue. Without it this
 * screen is a trap for anyone who tapped *Create an account* meaning *Sign
 * in*, and the trap is worse here than it would be on the form, because there
 * is nothing on this screen that looks like authentication at all.
 *
 * It does **not** clear the draft. Signing in on a device where somebody had
 * started answering is not a reason to throw the answers away — and if that
 * account is already onboarded, nothing is ever sent. `signOut` clears it,
 * which is the point where a draft could reach the wrong account.
 */
export function SignUpOnboardingScreen({
  onContinue,
  onSignInInstead,
}: SignUpOnboardingScreenProps) {
  const draft = useOnboardingDraft();

  return (
    <OnboardingForm
      initial={draft}
      renderFooterLink={(answers) => (
        <Pressable
          onPress={() => {
            // Kept on the way out too. Someone who typed their name and then
            // realised they already have an account should not find the field
            // empty when they come back.
            onboardingDraft.set(answers);
            onSignInInstead();
          }}
          accessibilityRole="button"
          accessibilityLabel="Sign in instead"
          style={({ pressed }) => [
            styles.target,
            styles.switch,
            pressed && styles.switchPressed,
          ]}
        >
          <Text variant="metadata" color="textSecondary">
            Already have an account?{' '}
            <Text variant="metadata" color="textPrimary">
              Sign in
            </Text>
          </Text>
        </Pressable>
      )}
      onSubmit={(answers) => {
        onboardingDraft.set(answers);
        onContinue();
      }}
    />
  );
}

const styles = StyleSheet.create({
  target: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  // Matches the account switcher at the foot of `AuthScreen`, because it is the
  // same control in the same place doing the same thing.
  switch: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  switchPressed: {
    opacity: 0.6,
  },
});
