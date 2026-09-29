import { StyleSheet } from 'react-native';

import { PrimaryButton, Text } from '../../components/primitives';
import { spacing } from '../../design';
import { ONBOARDING_STEPS } from '../../lib/onboardingSteps';
import { CentredScreen } from './CentredScreen';
import { ScanIllustration } from './ScanIllustration';

/** "Six", from the list, so the promise and the progress bar cannot disagree. */
const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

export interface OnboardingWelcomeProps {
  onNext: () => void;
}

/**
 * Before the first question (`redesign/OnboardWelcome.dc.html`): a
 * photographed page being read and its tempo found, and how long the questions
 * will take. What the app is for is the screen before this one
 * (`OnboardingHowItWorks`): it was a sentence here for a day, and the owner
 * asked for a screen instead of a sentence nobody reads (2026-09-29).
 *
 * The prototype's "I already have an account" is not drawn: the questions come
 * after the account now, so there is always one.
 *
 * The three-foot test: the page being read first, "Let's get you set up"
 * second, Next third. The illustration is allowed to lead because it is the
 * product; the title under it is the invitation.
 */
export function OnboardingWelcome({ onNext }: OnboardingWelcomeProps) {
  const count = COUNT_WORDS[ONBOARDING_STEPS.length] ?? String(ONBOARDING_STEPS.length);

  return (
    <CentredScreen
      footer={<PrimaryButton label="Next" onPress={onNext} />}
    >
      <ScanIllustration />
      <Text variant="displayTitle" accessibilityRole="header" style={styles.title}>
        Let’s get you set up
      </Text>
      <Text variant="body" color="textSecondary" style={styles.lede}>
        {count} quick questions, then your first piece.
      </Text>
    </CentredScreen>
  );
}

const styles = StyleSheet.create({
  title: {
    marginTop: 48,
    fontSize: 40,
    lineHeight: 46,
    textAlign: 'center',
  },
  lede: {
    marginTop: spacing.md,
    maxWidth: 320,
    textAlign: 'center',
  },
});
