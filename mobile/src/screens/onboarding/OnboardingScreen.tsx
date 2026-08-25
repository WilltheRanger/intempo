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
import { profileUpdateFor } from '../../lib/onboarding';

/**
 * The one screen between signing up and using the app.
 *
 * **One screen, and skippable** — the owner's decision on 2026-08-24, over a
 * multi-step wizard. Someone who has just signed up opened this app to
 * practise, and four screens of questions before they can is a toll on the
 * thing they came for.
 *
 * ## What it asks for, and what each is worth
 *
 * Only the **instrument** changes what the app does: it sets the clef and
 * range of the daily excerpt, and it reaches `analyze(..., double_bass=)` on
 * every take. The **name** changes a greeting. The **photograph** currently
 * changes nothing at all — there is no screen in the app where another person
 * appears — and it is here because the owner asked for it, over a
 * recommendation to wait for the teacher tier to give it a reason.
 *
 * That ordering is the composition. The instrument is the weightiest control
 * on the screen and the photograph is a small circle beside the name, because
 * a large one at the top would make the least consequential field the dominant
 * element (§3 law 4) and it would be lying about what matters.
 *
 * ## The three-foot test, run before this was written
 *
 * 1. **"Who's playing?"** — one serif line, the screen's only editorial moment.
 * 2. **The four instruments** — the answer that changes the app.
 * 3. **Continue**, in the thumb zone, with Skip receding below it.
 *
 * ## Skipping is an answer
 *
 * Skip writes `onboarded: true` and nothing else. Being asked is what the
 * server records, so someone who declines is not asked again — a skippable
 * screen that reappears is not skippable. The instrument then stays on the
 * device preference, which is where it has always lived and which has a
 * sensible default; the app is no worse off than it was before this screen
 * existed.
 *
 * ## Nothing is written until Continue
 *
 * The photograph uploads when it is chosen, because that is slow and the
 * bytes may as well be moving while a name is typed — but the account is not
 * pointed at it until the save. Someone who picks a picture and then backs out
 * leaves an orphan in the bucket rather than a profile they did not agree to,
 * which is the right way round. (Orphaned uploads are a known, unfixed hole —
 * see the capture-path notes in `CLAUDE.md`. This screen adds a second way to
 * make one; it does not add a new problem.)
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
 * What the screen *sends* and whether it is *shown* are both real rules, so
 * both live in `lib/onboarding.ts` where they can be.
 */
export function OnboardingScreen() {
  const save = useUpdateProfile();
  const upload = useUploadAvatar();

  const [name, setName] = useState('');
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
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
    try {
      setAvatarKey(
        await upload.mutateAsync({
          uri: asset.uri,
          mimeType: asset.mimeType ?? 'image/jpeg',
        }),
      );
    } catch (cause) {
      // The preview stays. The picture they chose is still the picture they
      // chose, and clearing it would read as the app rejecting the photograph
      // rather than failing to send it.
      setAvatarKey(null);
      setError(
        cause instanceof Error
          ? cause.message
          : 'That photo could not be uploaded. You can carry on without it.',
      );
    }
  }

  async function finish(skipping: boolean) {
    setError(null);
    try {
      // The mutation resolves only once `me` has been refetched, so the button
      // stays in its loading state right up to the moment the gate lifts —
      // rather than going idle for a frame under a screen that hasn't moved.
      await save.mutateAsync(
        profileUpdateFor({ name, instrument, avatarKey }, { skipping }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'That could not be saved. Try again.',
      );
    }
  }

  const busy = save.isPending;

  return (
    <ScreenContainer
      footer={
        <View>
          <PrimaryButton
            label="Continue"
            onPress={() => void finish(false)}
            loading={busy}
            disabled={busy || upload.isPending}
          />
          {/*
            Quieter than Continue and below it, because it is the lesser of two
            real choices rather than a way out of a mistake. Someone who does
            not want to answer should be able to leave without hunting.
          */}
          <Pressable
            onPress={() => void finish(true)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
            style={styles.skip}
          >
            <Text variant="metadataSmall" color="textSecondary">
              Skip for now
            </Text>
          </Pressable>
        </View>
      }
    >
      <Text variant="heroTitle" style={styles.heading}>
        Who&apos;s playing?
      </Text>
      <Text variant="body" color="textSecondary" style={styles.lede}>
        Your instrument sets the daily warmup and how your playing is read. All
        of it can be changed later.
      </Text>

      {/*
        The photograph sits beside the name because they are the same question
        — who you are — and because a large circle at the top would make the
        one field that changes nothing the first thing anyone saw.
      */}
      <View style={styles.identity}>
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

        <Input
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Optional"
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

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {upload.isPending ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.error}>
          Sending your photo…
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
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing['3xl'],
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
  error: {
    marginTop: spacing.lg,
  },
  skip: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
});
