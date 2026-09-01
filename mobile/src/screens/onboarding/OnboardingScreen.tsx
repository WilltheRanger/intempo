import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'lucide-react-native';
import { useState } from 'react';
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
import { useUpdateProfile, useUploadAvatar } from '../../data/hooks/useProfile';
import type { Instrument } from '../../data/types';
import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  spacing,
} from '../../design';
import {
  describeMissing,
  missingFromOnboarding,
  profileUpdateFor,
} from '../../lib/onboarding';

/**
 * The one screen between signing up and using the app.
 *
 * **One screen** — the owner's decision on 2026-08-24, over a multi-step
 * wizard. Someone who has just signed up opened this app to practise, and four
 * screens of questions before they can is a toll on the thing they came for.
 *
 * **All three answers are required** — the owner's decision on 2026-08-25,
 * *"dont make name profile and instrument optional"*, reversing the skippable
 * version shipped earlier the same day. There is no Skip.
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
 * ## The three-foot test, run before this was written
 *
 * 1. **"Who's playing?"** — one serif line, the screen's only editorial moment.
 * 2. **The four instruments** — the answer that changes the app.
 * 3. **Continue**, in the thumb zone, with the still-needed line under it.
 *
 * ## Nothing is sent until Continue
 *
 * Choosing a photograph only creates a local preview. Continue uploads it and
 * then saves the resulting object key with the rest of the profile. Changing
 * the selection or leaving this screen therefore does not strand an unused
 * object in storage.
 *
 * The upload and profile save are one visible action but remain two network
 * requests. If the upload succeeds and the save fails, its object key stays in
 * state and the next Continue retries only the save. That avoids a duplicate
 * upload on an unreliable connection and keeps the button busy until the
 * onboarding gate actually lifts.
 *
 * ## It navigates nowhere
 *
 * `RootNavigator` holds this screen in front of the app while
 * `shouldOnboard(me)`, the way the sign-in and password-reset screens are
 * held. Saving invalidates `me`; `onboarded` becomes true; the gate falls
 * away. There is no `navigate` and no `reset` here, so there is no route this
 * screen can be wrong about — which matters, because navigation is the part of
 * this app nothing tests.
 *
 * Everything this screen can get wrong lives in `lib/onboarding.ts`, where it
 * is tested: what it must have, what it sends, what it says is missing, and
 * whether it is shown at all.
 */
export function OnboardingScreen() {
  const save = useUpdateProfile();
  const upload = useUploadAvatar();

  const [name, setName] = useState('');
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{
    uri: string;
    mimeType: string;
  } | null>(null);
  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickPhoto() {
    setError(null);
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
    setPreview(asset.uri);
    setSelectedPhoto({
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
    });
    // A new local choice supersedes any key retained from a previous Continue.
    // Nothing is uploaded from the picker: abandoning or replacing this choice
    // must not create an unused storage object.
    setAvatarKey(null);
  }

  async function finish() {
    setError(null);

    let key = avatarKey;
    if (!key && selectedPhoto) {
      try {
        key = await upload.mutateAsync(selectedPhoto);
        // Retain a successful upload across a profile-save failure. Retrying
        // Continue will reuse this key instead of creating another object.
        setAvatarKey(key);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `${cause.message} Try Continue again.`
            : 'That photo could not be sent. Try Continue again.',
        );
        return;
      }
    }

    if (!key) {
      // The button is disabled in this state; this guard also protects direct
      // calls and future changes to the form rules.
      setError('Choose a photo before continuing.');
      return;
    }

    try {
      // The mutation resolves only once `me` has been refetched, so the button
      // stays in its loading state right up to the moment the gate lifts —
      // rather than going idle for a frame under a screen that hasn't moved.
      await save.mutateAsync(
        profileUpdateFor({ name, instrument, avatarKey: key }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'That could not be saved. Try again.',
      );
    }
  }

  const missing = missingFromOnboarding({
    name,
    instrument,
    avatarKey,
    photoSelected: Boolean(selectedPhoto),
  });
  const stillNeeded = describeMissing(missing);
  const busy = save.isPending || upload.isPending;

  return (
    <ScreenContainer
      footer={
        <View>
          <PrimaryButton
            label="Continue"
            onPress={() => void finish()}
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
            accessibilityLabel={preview ? 'Change photo' : 'Add a photo'}
          >
            {/*
              An empty slot, not the brand mark. `Avatar`'s placeholder is the
              charcoal-and-gold device, and it was the only saturated colour on
              this screen — so from three feet the least consequential field was
              the thing that pulled the eye (§3 law 4). It is also the wrong
              statement: there is no picture here, and the mark reads as one.
            */}
            {preview ? (
              <Avatar source={preview} size={PHOTO_SIZE} />
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

      {upload.isPending ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.note}>
          Sending your photo…
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
