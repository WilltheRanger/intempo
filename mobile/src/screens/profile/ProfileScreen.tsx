import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import appConfig from '../../../app.json';
import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import {
  Avatar,
  EmptyState,
  LoadingState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  RuledHeading,
  SegmentedControl,
  Text,
  ToggleRow,
} from '../../components/primitives';
import { signOut } from '../../data/auth/session';
import { useMe } from '../../data/hooks/useMe';
import { useUpdateProfile, useUploadAvatar } from '../../data/hooks/useProfile';
import type { Musician } from '../../data/types';
import { preferences, usePreferences } from '../../data/preferences';
import type { Instrument, MetronomeMode } from '../../data/types';
import { describeLoadError } from '../../data/describeLoadError';
import { metronomeChoices } from '../../lib/record/metronomeChoice';
import {
  ProfilePhotoSaveError,
  saveProfilePhoto,
  type ProfilePhotoSelection,
} from '../../data/profile/savePhoto';
import { Camera } from '../../components/icons';
import {
  BORDER_WIDTH,
  colors,
  ICON_STROKE_WIDTH,
  spacing,
} from '../../design';
import { formatTier } from '../../lib/format';
import type { RootNavigation } from '../../navigation/types';
import { AccountRow } from './AccountRow';
import { loadStateFor } from '../../lib/loadState';

/**
 * The account, and the settings that belong to this device.
 *
 * The account half comes from `GET /v1/me` — email, tier, role, and studio
 * membership are the whole of what the backend knows about a musician. The
 * settings half is local and, deliberately, only holds switches that change
 * something today: the metronome default the recorder will start from, the
 * haptics every button in the app now routes through, and a motion setting
 * that every animation already consults. Nothing here is a row that looks
 * like a control and isn't one.
 */
export function ProfileScreen() {
  const { data: musician, isError, error, isFetching, refetch } = useMe();
  const load = loadStateFor({ isError, hasData: musician !== undefined });
  const settings = usePreferences();
  const navigation = useNavigation<RootNavigation>();
  const queryClient = useQueryClient();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const saveProfile = useUpdateProfile();
  const saveConsent = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<ProfilePhotoSelection | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const photoBusy = saveProfile.isPending || uploadAvatar.isPending;

  /**
   * Finishes both halves of a photo replacement without repeating the first.
   *
   * The storage upload and the account save are two network calls. A dropped
   * connection between them retains the returned key, and the retry button
   * resumes at the save instead of uploading the same private object again.
   */
  async function persistPhoto(selection: ProfilePhotoSelection) {
    if (photoBusy) {
      return;
    }
    setPhotoError(null);
    setPhotoPreview(selection.uri);

    try {
      await saveProfilePhoto(selection, {
        upload: (photo) => uploadAvatar.mutateAsync(photo),
        save: (input) => saveProfile.mutateAsync(input),
      });
      setPendingPhoto(null);
      // The profile mutation waits for the refreshed account before it
      // resolves, so the server-backed avatar is ready before this preview leaves.
      setPhotoPreview(null);
    } catch (cause) {
      const resume =
        cause instanceof ProfilePhotoSaveError ? cause.resume : selection;
      setPendingPhoto(resume);
      setPhotoError(
        cause instanceof Error
          ? cause.message
          : 'That profile picture could not be saved. Try again.',
      );
    }
  }

  async function pickPhoto() {
    if (photoBusy) {
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) {
      // Keep an earlier failed selection and its visible retry action. Opening
      // the picker and backing out must not turn a recoverable failure into a
      // dead end.
      return;
    }

    const asset = result.assets[0];
    const selection: ProfilePhotoSelection = {
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
    };
    setPendingPhoto(selection);
    await persistPhoto(selection);
  }

  async function changeTrainingConsent(trainingConsent: boolean) {
    if (saveConsent.isPending) {
      return;
    }
    setConsentError(null);
    try {
      await saveConsent.mutateAsync({ training_consent: trainingConsent });
    } catch (cause) {
      setConsentError(
        cause instanceof Error
          ? cause.message
          : 'That privacy setting could not be saved. Try again.',
      );
    }
  }

  async function handleSignOut() {
    setConfirmingSignOut(false);
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
      // Everything cached was fetched as this user. Drop it with the session
      // rather than leaving one account's library on screen after the next
      // person signs in.
      queryClient.clear();
    } catch {
      setSignOutError("Couldn't sign out. Check your connection and try again.");
    } finally {
      setSigningOut(false);
    }
  }

  if (load === 'loading') {
    return (
      <ScreenContainer>
        <PageHeader title="Profile" />
        <LoadingState />
      </ScreenContainer>
    );
  }

  const usage = describeUsage(musician?.usage ?? null);

  if (load === 'unavailable' || !musician) {
    return (
      <ScreenContainer>
        <PageHeader title="Profile" />
        <EmptyState
          fill
          title="Couldn't load your account"
          description={describeLoadError(error)}
          actionLabel={isFetching ? 'Trying…' : 'Try again'}
          onActionPress={() => void refetch()}
          actionDisabled={isFetching}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <PageHeader title="Profile" />

      {/*
        The photo leads, with the address beside it — the two things that say
        whose account this is. Everything below is what kind of account it is.
      */}
      <View style={styles.identity}>
        <Pressable
          onPress={() => void pickPhoto()}
          disabled={photoBusy}
          accessibilityRole="button"
          accessibilityLabel={
            photoBusy ? 'Changing profile picture' : 'Change profile picture'
          }
          style={({ pressed }) => (pressed ? styles.pressed : undefined)}
        >
          <Avatar
            source={photoPreview ?? musician.avatarUrl}
            size={AVATAR_SIZE}
            initial={musician.displayName ?? musician.email}
          />
          {/*
            **The affordance, instead of a sentence explaining it.** This block
            used to carry "Choose your profile picture to change it." under the
            avatar — a caption doing the job a control should do, which §3 calls
            out by name: a drawn affordance must do the thing it depicts, and
            the corollary is that a thing which does something should look like
            it. A camera badge is the convention every phone already teaches.
          */}
          <View style={styles.avatarBadge}>
            <Camera
              size={14}
              strokeWidth={ICON_STROKE_WIDTH}
              color={colors.onDark}
            />
          </View>
        </Pressable>

        {/*
          The name, then the address (`redesign/Profile.dc.html`): the name is
          who this is, the address is which account. An account that has not
          given a name shows the address alone, in ink, rather than a blank
          where a name would be.
        */}
        <View style={styles.identityText}>
          {musician.displayName ? (
            <Text variant="pieceTitle" numberOfLines={1}>
              {musician.displayName}
            </Text>
          ) : null}
          <Text
            variant="metadataSmall"
            color={musician.displayName ? 'textTertiary' : 'textPrimary'}
            style={[styles.identityEmail, musician.displayName ? styles.emailUnderName : null]}
            numberOfLines={2}
          >
            {musician.email}
          </Text>
        </View>
      </View>

      {/* Only when there is something to say. Idle, the badge says it. */}
      {photoError || photoBusy ? (
        <Text
          variant="metadataSmall"
          color={photoError ? 'textSecondary' : 'textTertiary'}
          accessibilityLiveRegion="polite"
          style={styles.photoNote}
        >
          {photoError ?? 'Saving your profile picture…'}
        </Text>
      ) : null}

      {photoError && pendingPhoto ? (
        <SecondaryButton
          label={
            pendingPhoto.avatarKey
              ? 'Try saving profile picture again'
              : 'Try sending profile picture again'
          }
          onPress={() => void persistPhoto(pendingPhoto)}
          disabled={photoBusy}
          style={styles.photoRetry}
        />
      ) : null}

      <RuledHeading label="Account" rule="borderStrong" style={styles.section} />
      {/*
        **A band, not a floating card, and the alignment is why.** Keeping one
        surface for Account was the right call — it groups a set of related
        facts, which is what §3 law 3 reserves a container for. But a card sits
        *inside* the screen gutter and then insets its own content, so its rows
        started 16pt right of the bare rows below and the eye had two left edges
        to track down one screen. That shipped in PR #103 and this fixes it.

        Full-bleed with its content at the gutter, the grouping survives and
        every row on the screen shares one vertical. Square, because a rounded
        corner touching the screen edge reads as a mistake.
      */}
      {/*
        Rows on the page, not in a band. The band grouped these on a white
        surface run to both edges; the redesign groups them the way it groups
        every section, with a heavy rule above and hairlines between, so
        Account reads as one of five sections rather than the one in a box.
        Role is gone with it — it restated the kind of account in a word the
        musician chose at sign-up and cannot change here.
      */}
      <View>
        <AccountRow label="Plan" value={formatTier(musician.tier)} />
        {/*
          The quota, before it is ever hit. `/v1/me` has carried this all
          along; the only other way to learn about the limit is to be refused
          by it right after playing something. Absent for unlimited tiers and
          when the server did not report it — "unknown" is not "unlimited".
        */}
        {usage ? <AccountRow label="Analyses" value={usage} /> : null}
        {/*
          The studio's name is not on `/v1/me`, only its id, which means
          nothing to the person reading it. The membership, and nothing for
          musicians who have none.
        */}
        {musician.studioId ? <AccountRow label="Studio" value="Connected" /> : null}
        <AccountRow label="Email" onPress={() => navigation.navigate('ChangeEmail')} />
        <AccountRow label="Password" onPress={() => navigation.navigate('ChangePassword')} />
      </View>

      <RuledHeading label="Practice" rule="borderStrong" style={styles.section} />
      <View style={styles.setting}>
        <Text variant="button" style={styles.settingTitle}>
          Instrument
        </Text>
        <SegmentedControl
          label="Instrument"
          options={INSTRUMENT_OPTIONS}
          value={settings.instrument}
          onChange={(instrument: Instrument) => preferences.setInstrument(instrument)}
        />
      </View>

      <View style={styles.setting}>
        <Text variant="button" style={styles.settingTitle}>
          Metronome
        </Text>
        <SegmentedControl
          label="Metronome"
          options={METRONOME_OPTIONS}
          value={settings.metronomeMode}
          onChange={(mode: MetronomeMode) => preferences.setMetronomeMode(mode)}
        />
        {settings.metronomeMode === 'audio_with_headphones' ? (
          <Text variant="metadataSmall" color="textTertiary" style={styles.settingCaveat}>
            Use headphones, or the click ends up in the recording.
          </Text>
        ) : null}
      </View>

      {/*
        **The warmup's only door**, and after the two settings rather than
        before them: the redesign's Practice section opens on the instrument,
        which is the choice the warmup is built from. A screen nothing opens is
        dead code on a phone (`navigationReachability.test.ts`).
      */}
      <AccountRow label="Daily warmup" onPress={() => navigation.navigate('Warmup')} />

      <RuledHeading label="Preferences" rule="borderStrong" style={styles.section} />
      <ToggleRow
        label="Haptic feedback"
        value={settings.haptics}
        onChange={preferences.setHaptics}
      />
      <ToggleRow
        label="Reduce motion"
        value={settings.reduceMotion}
        onChange={preferences.setReduceMotion}
      />

      <RuledHeading label="Data & privacy" rule="borderStrong" style={styles.section} />
      <View>
          <ToggleRow
            label="Help improve score reading"
            description="Keep your corrected bars and their photos to train the reader. Off deletes them."
            value={musician.trainingConsent}
            onChange={(value) => void changeTrainingConsent(value)}
            disabled={saveConsent.isPending}
          />
          {consentError ? (
            <Text
              variant="metadataSmall"
              color="textSecondary"
              accessibilityLiveRegion="polite"
              style={styles.consentError}
            >
              {consentError}
            </Text>
          ) : null}
          <AccountRow
            label="Download my data"
            onPress={() => navigation.navigate('ExportData')}
          />
          <AccountRow
            label="Delete account"
            value="Permanent"
            onPress={() => navigation.navigate('DeleteAccount')}
          />
      </View>

      <RuledHeading label="About" rule="borderStrong" style={styles.section} />
      <View>
          <AccountRow label="Version" value={appConfig.expo.version} />
          <AccountRow label="Help" onPress={() => navigation.navigate('Help')} />
          <AccountRow
            label="Privacy"
            onPress={() => navigation.navigate('Legal', { document: 'privacy' })}
          />
          <AccountRow
            label="Terms"
            onPress={() => navigation.navigate('Legal', { document: 'terms' })}
          />
          <AccountRow label="Open source" onPress={() => navigation.navigate('Acknowledgements')} />
      </View>

      <SecondaryButton
        label={signingOut ? 'Signing out…' : 'Sign out'}
        onPress={() => setConfirmingSignOut(true)}
        disabled={signingOut}
        style={styles.signOut}
      />

      {signOutError ? (
        <Text
          variant="metadataSmall"
          color="textSecondary"
          style={styles.error}
        >
          {signOutError}
        </Text>
      ) : null}

      <ConfirmDialog
        visible={confirmingSignOut}
        title="Sign out?"
        message="Your library stays on the server. You'll need your password to get back in."
        confirmLabel="Sign out"
        onConfirm={() => void handleSignOut()}
        onCancel={() => setConfirmingSignOut(false)}
      />
    </ScreenContainer>
  );
}

/** Large enough to carry a face, short of a hero portrait. */
const AVATAR_SIZE = 76;

/** The camera badge's diameter. Large enough to read, small enough to sit on the rim. */
const BADGE_SIZE = 26;

/**
 * The `metronome_mode` enum, in a musician's words. "Audio" carries the
 * headphones caveat below the control rather than in the label, where it
 * wouldn't fit and would crowd the other three.
 */
/**
 * The four bowed strings, in score order.
 *
 * "Bass" rather than "Double bass" in the control: four segments across a
 * phone leave no room for the longer word, and no one reading a string app
 * mistakes it for a bass guitar. The full name is used everywhere it fits —
 * `INSTRUMENT_LABELS`, which Today and the Warmup screen render, and the
 * roomier grid in `components/profile/InstrumentChoice`.
 *
 * This is the only shortening in the app, and
 * `lib/instrumentLabels.test.ts` is what keeps it the only one.
 */
const INSTRUMENT_OPTIONS = [
  { value: 'violin' as const, label: 'Violin' },
  { value: 'viola' as const, label: 'Viola' },
  { value: 'cello' as const, label: 'Cello' },
  { value: 'double_bass' as const, label: 'Bass' },
];

/**
 * The four modes, from the same list the record screen's picker offers.
 *
 * **It was a second copy of them**, written here when this was the only place
 * a mode could be chosen. `lib/record/metronomeChoice.ts` is now that list —
 * typed as a `Record<MetronomeMode, …>`, so a fifth mode stops compiling until
 * it is described — and two hand-written enumerations of one enum is exactly
 * the drift the segmented control cannot show you: it would simply be missing
 * an option, on the screen a musician was sent to to find it.
 */
const METRONOME_OPTIONS = metronomeChoices().map(({ mode, label }) => ({
  value: mode,
  label,
}));

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  photoNote: {
    marginTop: spacing.md,
  },
  photoRetry: {
    marginTop: spacing.md,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: 22,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  emailUnderName: {
    marginTop: 3,
  },
  identityEmail: {
    flexShrink: 1,
    /**
     * **An email address has nowhere to break.**
     *
     * `flexShrink` cannot act while CSS `min-width` is `auto` — its content —
     * so at 2x text "you@example.com" ran 11pt off a 390pt screen with two
     * lines allowed and neither of them used. Zero lets it shrink; breaking
     * mid-word lets it use the second line rather than be truncated, which
     * matters here because this block exists to say *which account you are
     * in* and "you@examp…" does not.
     *
     * Web only, and the same shape as the shims in `ToggleRow` and `Input`:
     * React Native already breaks a word too long for its line, so on device
     * this is a no-op.
     */
    minWidth: 0,
    ...Platform.select({ web: { wordBreak: 'break-all' as const }, default: {} }),
  },
  /**
   * A settings block standing on the page instead of on a card.
   *
   * §3 law 3 — the background is a compositional surface, and Profile was the
   * one screen in the app that had turned every section into a card (seven of
   * them). The account block keeps its card because it genuinely groups a set
   * of related facts; a lone control with a note above it does not.
   */
  setting: {
    paddingVertical: 14,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  settingTitle: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 10,
  },
  /**
   * The camera badge on the avatar.
   *
   * Sits on the circle's lower-right, where every phone puts it. Ringed in the
   * page background so it reads as attached to the avatar rather than floating
   * over whatever is behind it.
   */
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginTop: 26,
  },
  settingCaveat: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 17,
  },
  signOut: {
    marginTop: spacing['2xl'],
  },
  consentError: {
    paddingBottom: spacing.md,
  },
  error: {
    marginTop: spacing.md,
  },
});

/**
 * "2 of 3 this month", or null when there is nothing true to say.
 *
 * Null for an unlimited tier — a row reading "unlimited" on an account that
 * simply has no quota is noise — and null when the server didn't report usage
 * at all, since that means the count is unknown and printing anything would
 * invent it.
 */
function describeUsage(usage: Musician['usage']): string | null {
  if (!usage || usage.limit === null) {
    return null;
  }
  return `${usage.used} of ${usage.limit} this month`;
}
