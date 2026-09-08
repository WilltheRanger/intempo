import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { InstrumentChoice } from '../../components/profile/InstrumentChoice';
import {
  Avatar,
  Input,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
  Text,
} from '../../components/primitives';
import type { PickedPhoto } from '../../data/onboardingDraft';
import type { Instrument } from '../../data/types';
import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  pressedOpacity,
  spacing,
} from '../../design';
import { describeMissing, missingFromOnboarding } from '../../lib/onboarding';

/** What the three questions came back with. */
export interface OnboardingFormAnswers {
  /** As typed, untrimmed — trimming belongs to `lib/onboarding`. */
  name: string;
  instrument: Instrument | null;
  /** A photograph chosen here, before any upload. */
  photo: PickedPhoto | null;
}

export interface OnboardingFormProps {
  /** What to open with — the account's answers, or an unfinished draft. */
  initial: OnboardingFormAnswers;
  /** A photograph already on the account, shown when nothing local is chosen. */
  storedPhotoUrl?: string | null;
  busy?: boolean;
  /** A line under the instrument grid, for work in progress. */
  note?: string | null;
  error?: string | null;
  /**
   * Sits under Continue and its still-needed line.
   *
   * Given the answers as they stand, so a link that leaves this screen can
   * keep them. Without that, typing a name and then taking the way out throws
   * it away — which the way out has no business doing, and which is invisible
   * until you come back and find the field empty.
   */
  renderFooterLink?: (answers: OnboardingFormAnswers) => ReactNode;
  onSubmit: (answers: OnboardingFormAnswers) => void;
}

/**
 * The three questions, and nothing about where the answers go.
 *
 * **One form, two callers**, since 2026-09-08 put onboarding *before* the
 * sign-up form: `SignUpOnboardingScreen` writes the answers to a device draft
 * and moves on to creating the account, and `OnboardingScreen` uploads the
 * photograph and saves them to an account that already exists. Everything
 * below is identical in both, which is the reason it is here rather than
 * written twice — the composition was art-directed once and a second copy is a
 * second thing to keep in step.
 *
 * ## What each answer is worth, and what requiring it costs
 *
 * Only the **instrument** changes what the app does: it sets the clef and
 * range of the daily warmup, and it reaches `analyze(..., double_bass=)` on
 * every take. The **name** changes a greeting. The **photograph** currently
 * changes nothing at all — there is no screen in the app where another person
 * appears.
 *
 * The photograph is therefore the expensive requirement, and the cost is worth
 * stating plainly: it is the only answer that cannot be given by thinking.
 * Someone signing up away from a picture they are happy with has to stop, find
 * one, and until they do the app is shut. That is the owner's call and it is
 * made — recorded here so whoever reads this next sees the trade rather than
 * only the rule.
 *
 * ## The composition
 *
 * Requiring all three does not make them equally important, and the screen
 * does not pretend it does. The instrument grid is still the weightiest block
 * and the photograph is still a circle beside the name, because a large one at
 * the top would make the least consequential field the dominant element
 * (§3 law 4). What requiring it changes is not the size of the control but
 * whether a blocked musician can tell **why** — hence the line above Continue
 * naming what is still missing. A disabled button with no reason beside it is
 * a tap that did nothing.
 *
 * ## The three-foot test
 *
 * 1. **"Who's playing?"** — one serif line, the screen's only editorial moment.
 * 2. **The four instruments** — the answer that changes the app.
 * 3. **Continue**, in the thumb zone, with the still-needed line under it.
 *
 * Re-run after the move, on the pre-sign-up screen, which adds one thing: a
 * quiet "Already have an account? Sign in" below Continue. It comes fourth and
 * is meant to — it is an exit for someone who tapped the wrong thing, not an
 * invitation.
 *
 * ## Nothing leaves this component
 *
 * Choosing a photograph only creates a local preview. Submitting hands the
 * chosen file to the caller, which decides whether that means an upload or a
 * line in a draft. So abandoning or replacing a choice cannot strand an
 * object in storage, because nothing here can put one there.
 */
export function OnboardingForm({
  initial,
  storedPhotoUrl = null,
  busy = false,
  note = null,
  error = null,
  renderFooterLink,
  onSubmit,
}: OnboardingFormProps) {
  const [name, setName] = useState(initial.name);
  const [instrument, setInstrument] = useState(initial.instrument);
  const [photo, setPhoto] = useState(initial.photo);

  /** The just-chosen photograph if there is one, otherwise the account's. */
  const shownPhoto = photo?.uri ?? storedPhotoUrl;
  const storedPhoto = Boolean(storedPhotoUrl);

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // Square, because it is rendered in a circle everywhere it appears.
      // Cropping here rather than at display time means the musician chooses
      // what is inside the circle instead of discovering it afterwards.
      allowsEditing: true,
      aspect: [1, 1],
      // **Not 1.** A quality forces a re-encode to JPEG, which is the point:
      // an iPhone shoots HEIC, the server refuses HEIC for an avatar, and
      // Chrome and Firefox cannot display it anyway. 0.8 of a face in a 42pt
      // circle is indistinguishable from 1.
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) {
      return;
    }

    const asset = result.assets[0];
    setPhoto({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
  }

  const missing = missingFromOnboarding({
    name,
    instrument,
    avatarKey: null,
    photoSelected: Boolean(photo),
    storedPhoto,
  });
  const stillNeeded = describeMissing(missing);

  return (
    <ScreenContainer
      footer={
        <View>
          <PrimaryButton
            label="Continue"
            onPress={() => onSubmit({ name, instrument, photo })}
            loading={busy}
            disabled={busy || missing.length > 0}
          />
          {/*
            Under the button, not above it: it is a caption on why that control
            is shut, and it reads in the order the eye arrives — button first,
            reason second. Absent entirely once nothing is missing, rather than
            an empty line holding space (`describeMissing` returns null).
          */}
          {stillNeeded ? (
            <Text
              variant="metadataSmall"
              color="textSecondary"
              style={styles.stillNeeded}
            >
              {stillNeeded}
            </Text>
          ) : null}
          {renderFooterLink?.({ name, instrument, photo })}
        </View>
      }
    >
      <Text variant="heroTitle" style={styles.heading}>
        Who&apos;s playing?
      </Text>
      <Text variant="body" color="textSecondary" style={styles.lede}>
        Your instrument sets the daily warmup and how your playing is read.
      </Text>

      {/*
        Two labelled fields side by side, because they are the same question —
        who you are. The photograph carries its own label now that it is
        required: without one it read as decoration on the name field, and a
        required field nobody recognises as a field is how someone ends up
        staring at a disabled button.
      */}
      <View style={styles.identity}>
        <View>
          <Text variant="sectionLabel" color="textSecondary" style={styles.photoLabel}>
            Photo
          </Text>
          <Pressable
            onPress={() => void pickPhoto()}
            accessibilityRole="button"
            accessibilityLabel={shownPhoto ? 'Change photo' : 'Add a photo'}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            {/*
              An empty slot, not the brand mark. `Avatar`'s placeholder is the
              charcoal-and-gold device, and it was the only saturated colour on
              this screen — so from three feet the least consequential field was
              the thing that pulled the eye (§3 law 4). It is also the wrong
              statement: there is no picture here, and the mark reads as one.
            */}
            {shownPhoto ? (
              <Avatar source={shownPhoto} size={PHOTO_SIZE} />
            ) : (
              <View style={styles.emptyPhoto}>
                <Camera
                  size={ICON_SIZE.md}
                  strokeWidth={ICON_STROKE_WIDTH}
                  color={colors.textTertiary}
                />
              </View>
            )}
          </Pressable>
        </View>

        <Input
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="What should we call you?"
          autoCapitalize="words"
          autoComplete="name"
          style={styles.name}
        />
      </View>

      <SectionHeader label="Instrument" style={styles.section} />
      <InstrumentChoice
        label="Instrument"
        value={instrument}
        onChange={setInstrument}
      />

      {note ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.note}>
          {note}
        </Text>
      ) : null}

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.note}>
          {error}
        </Text>
      ) : null}
    </ScreenContainer>
  );
}

/** Big enough to see a face in, small enough not to lead the screen. */
const PHOTO_SIZE = 64;

const styles = StyleSheet.create({
  /*
    Every tappable thing on this screen acknowledges the touch. These were bare
    `Pressable`s with a static style, so a tap produced no response at all until
    whatever it triggered appeared — which on a slow action reads as the control
    being dead. `PressableScale` is for the large targets; the app's answer for
    small ones is a colour or opacity change, and these had neither.
  */
  pressed: {
    opacity: pressedOpacity,
  },
  heading: {
    marginTop: spacing['2xl'],
  },
  lede: {
    marginTop: spacing.md,
  },
  identity: {
    flexDirection: 'row',
    // Top-aligned so the two labels sit on one line and the controls start
    // together. Centring would stagger the labels, which reads as a mistake.
    alignItems: 'flex-start',
    gap: spacing.lg,
    marginTop: spacing['3xl'],
  },
  photoLabel: {
    marginBottom: spacing.sm,
  },
  emptyPhoto: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  name: {
    flex: 1,
  },
  section: {
    marginTop: spacing['3xl'],
  },
  note: {
    marginTop: spacing.lg,
  },
  stillNeeded: {
    alignSelf: 'center',
    marginTop: spacing.md,
  },
});
