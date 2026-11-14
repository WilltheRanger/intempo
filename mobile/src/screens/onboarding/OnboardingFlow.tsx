import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Input, Text, choiceTile } from '../../components/primitives';
import { InstrumentChoice } from '../../components/profile/InstrumentChoice';
import { preferences, usePreferences } from '../../data/preferences';
import type { Instrument } from '../../data/types';
import { radii, spacing } from '../../design';
import type { PickedPhoto } from '../../lib/onboarding';
import {
  canContinue,
  nextStep,
  previousStep,
  ROLE_CHOICES,
  type OnboardingStep,
  type PracticeRole,
} from '../../lib/onboardingSteps';
import type { SceneDirection } from '../../navigation/sceneMotion';
import { OnboardingHowItWorks } from './OnboardingHowItWorks';
import { OnboardingWelcome } from './OnboardingWelcome';
import { StepFrame, type StepAction } from './StepFrame';
import { FIELD_LIMITS } from '../../lib/fieldLimits';
import { announceScreenStep } from '../../lib/screenStep';

/** The answers that go to the account. */
export interface OnboardingAnswers {
  /** As typed, untrimmed — trimming belongs to `lib/onboarding`. */
  name: string;
  instrument: Instrument | null;
  /** A photograph chosen here, before any upload. */
  photo: PickedPhoto | null;
}

export interface OnboardingFlowProps {
  /** What to open with: whatever the account already has. */
  initial: OnboardingAnswers;
  busy?: boolean;
  /** Why finishing did not go through, shown on the last step. */
  error?: string | null;
  onFinish: (answers: OnboardingAnswers) => void;
}

type Place = 'about' | 'welcome' | OnboardingStep;

/**
 * The redesign's onboarding (`redesign/OnboardWelcome.dc.html` through
 * `OnboardPhoto.dc.html`): what the app does (`OnboardingHowItWorks`, 2026-09-29),
 * Welcome, then one question a screen — name,
 * instrument, learning or teaching, the microphone, where you heard of us, a
 * photograph.
 *
 * **After the account, not before it** (owner's call, 2026-09-23, reversing
 * 2026-09-08 — `DECISIONS.md`): the questions are what a new account sees once
 * its confirmation link is opened, and `OnboardingScreen` sends the answers to
 * it. What happens to the answers is that screen's; everything a musician
 * sees is here.
 *
 * **Where each answer goes.** The name and the instrument are the account's,
 * and the two onboarding requires. The photograph is the account's too, and
 * optional (owner's call, 2026-09-23 — `DECISIONS.md`). The role and "how did
 * you find us" are kept on the device (`preferences`), because the API has
 * nowhere to put them yet — and they are written as they are answered, so
 * leaving part-way through keeps them.
 *
 * The order and what holds Next shut are `lib/onboardingSteps`, where they are
 * tested. Steps are state rather than routes because nothing outside this
 * flow ever needs to open one of them, and a route is a thing a deep link can
 * land on half-way through.
 */
export function OnboardingFlow({
  initial,
  busy = false,
  error = null,
  onFinish,
}: OnboardingFlowProps) {
  const saved = usePreferences();
  const [place, setPlace] = useState<Place>('about');
  const [direction, setDirection] = useState<SceneDirection>('none');
  const [name, setName] = useState(initial.name);
  const [instrument, setInstrument] = useState(initial.instrument);
  // **Nothing chosen until the musician chooses** (2026-09-29). This was
  // "learning" from the start, so a teacher tapping Next through the flow was
  // filed as a student without being asked.
  const [role, setRole] = useState<PracticeRole | null>(saved.practiceRole);
  // No photo step any more; an account's own photograph passes through.
  const photo = initial.photo;

  // A new step is a new screen to someone who cannot see it slide in: focus
  // goes to its title, as it does when a screen is pushed (`screenStep.ts`).
  // Every place, the two introductions included, and not the first, which is
  // where the page loaded.
  useEffect(() => {
    if (direction !== 'none') announceScreenStep(place);
  }, [place, direction]);

  const answers = { name, instrument, role };
  const current = (): OnboardingAnswers => ({ name, instrument, photo });

  function go(next: Place, way: SceneDirection) {
    setDirection(way);
    setPlace(next);
  }

  function forward(step: OnboardingStep) {
    const next = nextStep(step);
    if (next) {
      go(next, 'forward');
    } else {
      onFinish(current());
    }
  }

  function back(step: OnboardingStep) {
    go(previousStep(step) ?? 'welcome', 'back');
  }

  if (place === 'about') {
    return <OnboardingHowItWorks onNext={() => go('welcome', 'forward')} />;
  }

  if (place === 'welcome') {
    return (
      <OnboardingWelcome onNext={() => go('name', 'forward')} />
    );
  }

  const step = place;
  const next: StepAction = {
    label: 'Next',
    onPress: () => forward(step),
    disabled: !canContinue(step, answers),
  };
  const frame = { step, direction, onBack: () => back(step) };

  switch (step) {
    case 'name':
      return (
        <StepFrame
          {...frame}
          title="What’s your name?"
          primary={next}
        >
          <Input
            label="Name"
            maxLength={FIELD_LIMITS.displayName}
            value={name}
            onChangeText={setName}
            placeholder="First name"
            serif
            large
            autoCapitalize="words"
            autoComplete="name-given"
            textContentType="givenName"
            returnKeyType="next"
            onSubmitEditing={() => {
              if (canContinue('name', answers)) {
                forward('name');
              }
            }}
          />
        </StepFrame>
      );

    case 'instrument':
      return (
        <StepFrame
          {...frame}
          title="What do you play?"
          primary={next}
        >
          <InstrumentChoice label="Instrument" value={instrument} onChange={setInstrument} />
        </StepFrame>
      );

    case 'role':
      return (
        <StepFrame
          {...frame}
          title="Learning or teaching?"
          // **The last step** since 2026-11-12, when the microphone, "how did
          // you find us" and the photo left onboarding (the owner's call): it
          // finishes, so it carries the save's wait and its error.
          primary={{
            ...next,
            label: 'Finish',
            loading: busy,
            onPress: () => {
              if (role) preferences.setPracticeRole(role);
              forward('role');
            },
          }}
          error={error}
        >
          <View accessibilityRole="radiogroup" accessibilityLabel="Learning or teaching?">
            {ROLE_CHOICES.map((choice) => {
              const selected = role === choice.value;
              return (
                <Pressable
                  key={choice.value}
                  onPress={() => setRole(choice.value)}
                  accessibilityRole="radio"
                  aria-checked={selected}
                  accessibilityState={{ selected }}
                  accessibilityLabel={choice.title}
                  style={({ pressed }) => [
                    choiceTile.surface,
                    styles.roleChoice,
                    selected && choiceTile.chosen,
                    pressed && choiceTile.pressed,
                  ]}
                >
                  <Text variant="pieceTitle" color="textPrimary">
                    {choice.title}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </StepFrame>
      );
  }
}


const styles = StyleSheet.create({
  roleChoice: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    // A choice, so `md` — never the button's capsule (`radii.ts`).
    borderRadius: radii.md,
  },
});
