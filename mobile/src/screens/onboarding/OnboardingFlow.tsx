import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Camera, FileMusic, Images, Mic, Settings } from '../../components/icons';
import { Avatar, Input, Text } from '../../components/primitives';
import { InstrumentChoice } from '../../components/profile/InstrumentChoice';
import type { PickedPhoto } from '../../data/onboardingDraft';
import { preferences, usePreferences } from '../../data/preferences';
import type { Instrument } from '../../data/types';
import { BORDER_WIDTH, colors, fontFamily, MIN_TOUCH_TARGET, spacing } from '../../design';
import { requestMicrophoneAccess } from '../../lib/audioRecorder';
import {
  canContinue,
  FOUND_VIA_CHOICES,
  nextStep,
  previousStep,
  ROLE_CHOICES,
  type FoundVia,
  type OnboardingStep,
  type PracticeRole,
} from '../../lib/onboardingSteps';
import type { SceneDirection } from '../../navigation/sceneMotion';
import { ListeningIllustration } from './ListeningIllustration';
import { OnboardingWelcome } from './OnboardingWelcome';
import { StepFrame, type StepAction } from './StepFrame';

/** The answers that go to the account, or to the draft that waits for one. */
export interface OnboardingAnswers {
  /** As typed, untrimmed — trimming belongs to `lib/onboarding`. */
  name: string;
  instrument: Instrument | null;
  /** A photograph chosen here, before any upload. */
  photo: PickedPhoto | null;
}

export interface OnboardingFlowProps {
  /** What to open with — the account's answers, or an unfinished draft. */
  initial: OnboardingAnswers;
  /** A photograph already on the account, shown when nothing is chosen. */
  storedPhotoUrl?: string | null;
  /** The last step's button: "Finish" on an account, "Next" before one. */
  finishLabel: string;
  /** Welcome's "I already have an account", given the answers so far. */
  onHaveAccount?: (answers: OnboardingAnswers) => void;
  busy?: boolean;
  /** Why finishing did not go through, shown on the last step. */
  error?: string | null;
  onFinish: (answers: OnboardingAnswers) => void;
}

type Place = 'welcome' | OnboardingStep;

/**
 * The redesign's onboarding (`redesign/OnboardWelcome.dc.html` through
 * `OnboardPhoto.dc.html`): Welcome, then one question a screen — name,
 * instrument, learning or teaching, the microphone, where you heard of us, a
 * photograph.
 *
 * **One flow, two callers**, as the single form before it was:
 * `SignUpOnboardingScreen` keeps the answers in a device draft and moves on
 * to creating the account, and `OnboardingScreen` sends them to an account
 * that already exists. What happens to the answers is theirs; everything a
 * musician sees is here.
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
  storedPhotoUrl = null,
  finishLabel,
  onHaveAccount,
  busy = false,
  error = null,
  onFinish,
}: OnboardingFlowProps) {
  const saved = usePreferences();
  const [place, setPlace] = useState<Place>('welcome');
  const [direction, setDirection] = useState<SceneDirection>('none');
  const [name, setName] = useState(initial.name);
  const [instrument, setInstrument] = useState(initial.instrument);
  // One of the two is always chosen, as the prototype draws it: learning is
  // what nearly everybody arriving here is doing.
  const [role, setRole] = useState<PracticeRole>(saved.practiceRole ?? 'learning');
  const [source, setSource] = useState<FoundVia | null>(saved.foundVia);
  const [photo, setPhoto] = useState(initial.photo);
  const [asking, setAsking] = useState(false);

  const answers = { name, instrument, role, source };
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

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // Square, because it is shown in a circle everywhere it appears, and
      // cropping here lets the musician choose what is inside the circle.
      allowsEditing: true,
      aspect: [1, 1],
      // Not 1: a quality forces a re-encode to JPEG, and an iPhone shoots HEIC,
      // which the server refuses for an avatar and most browsers cannot show.
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) {
      return;
    }
    const asset = result.assets[0];
    setPhoto({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
  }

  if (place === 'welcome') {
    return (
      <OnboardingWelcome
        onNext={() => go('name', 'forward')}
        onHaveAccount={onHaveAccount ? () => onHaveAccount(current()) : undefined}
      />
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
          primary={{
            ...next,
            onPress: () => {
              preferences.setPracticeRole(role);
              forward('role');
            },
          }}
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
                  accessibilityLabel={`${choice.title}. ${choice.detail}`}
                  style={({ pressed }) => [
                    styles.roleChoice,
                    selected && styles.chosen,
                    pressed && !selected && styles.choicePressed,
                  ]}
                >
                  <Text variant="pieceTitle" color={selected ? 'actionText' : 'textPrimary'}>
                    {choice.title}
                  </Text>
                  <Text
                    variant="metadataSmall"
                    style={[styles.roleDetail, { color: selected ? colors.onDarkMuted : colors.textTertiary }]}
                  >
                    {choice.detail}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </StepFrame>
      );

    case 'microphone':
      return (
        <StepFrame
          {...frame}
          title="InTempo listens while you play"
          primary={{
            label: 'Allow microphone',
            loading: asking,
            onPress: () => {
              setAsking(true);
              // Whatever the answer, the flow goes on: a refusal is an answer,
              // and the first take explains how to change it.
              void requestMicrophoneAccess().finally(() => {
                setAsking(false);
                forward('microphone');
              });
            },
          }}
          secondary={{ label: 'Not now', onPress: () => forward('microphone'), disabled: asking }}
        >
          <ListeningIllustration />
          <View style={styles.facts}>
            <Fact icon={Mic} text="Only while you record" />
            <Fact icon={FileMusic} text="Saved with the piece" />
            <Fact
              icon={Settings}
              text={Platform.OS === 'web' ? 'Turn it off in your browser' : 'Turn it off in Settings'}
            />
          </View>
        </StepFrame>
      );

    case 'source':
      return (
        <StepFrame
          {...frame}
          title="How did you find us?"
          primary={{
            ...next,
            label: source ? 'Next' : 'Skip',
            onPress: () => {
              preferences.setFoundVia(source);
              forward('source');
            },
          }}
        >
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="How did you find us?">
            {FOUND_VIA_CHOICES.map((choice) => {
              const selected = source === choice.value;
              return (
                <Pressable
                  key={choice.value}
                  // Tapping the chosen one again un-chooses it: "or skip it"
                  // has to stay possible after a stray tap.
                  onPress={() => setSource(selected ? null : choice.value)}
                  accessibilityRole="radio"
                  aria-checked={selected}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.chip,
                    selected && styles.chosen,
                    pressed && !selected && styles.choicePressed,
                  ]}
                >
                  <Text variant="metadata" color={selected ? 'actionText' : 'textPrimary'}>
                    {choice.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </StepFrame>
      );

    case 'photo': {
      const shown = photo?.uri ?? storedPhotoUrl;
      return (
        <StepFrame
          {...frame}
          title="Add a photo"
          primary={{ label: finishLabel, onPress: () => onFinish(current()), loading: busy }}
          secondary={
            shown
              ? undefined
              : { label: 'Do this later', onPress: () => onFinish(current()), disabled: busy }
          }
          error={error}
        >
          <View style={styles.photo}>
            <Pressable
              onPress={() => void pickPhoto()}
              accessibilityRole="button"
              accessibilityLabel={shown ? 'Change your photo' : 'Choose a photo'}
              style={({ pressed }) => [styles.photoSlot, pressed && styles.choicePressed]}
            >
              {shown ? (
                <Avatar source={shown} size={PHOTO} />
              ) : (
                <Camera size={34} strokeWidth={1.4} color={colors.textTertiary} />
              )}
            </Pressable>
            <Pressable
              onPress={() => void pickPhoto()}
              accessibilityRole="button"
              style={({ pressed }) => [styles.photoButton, pressed && styles.choicePressed]}
            >
              <Images size={17} strokeWidth={1.6} color={colors.textPrimary} />
              <Text variant="metadata" style={styles.photoButtonLabel}>
                {shown ? 'Change' : 'Choose a photo'}
              </Text>
            </Pressable>
          </View>
        </StepFrame>
      );
    }
  }
}

/** One line of what the microphone does and does not do. */
function Fact({ icon: Icon, text }: { icon: typeof Mic; text: string }) {
  return (
    <View style={styles.fact}>
      <Icon size={18} strokeWidth={1.5} color={colors.textTertiary} />
      <Text variant="metadata" color="textSecondary" style={styles.factText}>
        {text}
      </Text>
    </View>
  );
}

const PHOTO = 116;
const CHOICE_RADIUS = 14;

const styles = StyleSheet.create({
  roleChoice: {
    paddingVertical: spacing.lg,
    paddingHorizontal: 18,
    marginBottom: 10,
    borderRadius: CHOICE_RADIUS,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  roleDetail: {
    marginTop: spacing.xs,
  },
  chosen: {
    backgroundColor: colors.actionBg,
    borderColor: colors.actionBg,
  },
  choicePressed: {
    backgroundColor: colors.surfacePressed,
  },
  facts: {
    marginTop: 34,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    minHeight: 50,
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  factText: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: MIN_TOUCH_TARGET / 2,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  photo: {
    alignItems: 'center',
  },
  photoSlot: {
    width: PHOTO,
    height: PHOTO,
    borderRadius: PHOTO / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 18,
    marginTop: 18,
    borderRadius: MIN_TOUCH_TARGET / 2,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.borderStrong,
  },
  photoButtonLabel: {
    fontFamily: fontFamily.sansMedium,
  },
});
