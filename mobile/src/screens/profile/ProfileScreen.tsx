import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import appConfig from '../../../app.json';
import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import {
  Avatar,
  Card,
  EmptyState,
  LoadingState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  SectionHeader,
  SegmentedControl,
  Text,
} from '../../components/primitives';
import { signOut } from '../../data/auth/session';
import { useMe } from '../../data/hooks/useMe';
import { useUpdateProfile, useUploadAvatar } from '../../data/hooks/useProfile';
import type { Musician } from '../../data/types';
import { preferences, usePreferences } from '../../data/preferences';
import type { Instrument, MetronomeMode } from '../../data/types';
import { describeLoadError } from '../../data/api/describeError';
import { spacing } from '../../design';
import { formatRole, formatTier } from '../../lib/format';
import type { RootNavigation } from '../../navigation/types';
import { AccountRow } from './AccountRow';
import { LinkRow } from './LinkRow';
import { ToggleRow } from './ToggleRow';

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
  const { data: musician, isPending, isError, error } = useMe();
  const settings = usePreferences();
  const navigation = useNavigation<RootNavigation>();
  const queryClient = useQueryClient();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const saveProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoBusy = saveProfile.isPending || uploadAvatar.isPending;

  async function pickPhoto() {
    if (photoBusy) {
      return;
    }
    setPhotoError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) {
      return;
    }

    const asset = result.assets[0];
    setPhotoPreview(asset.uri);
    try {
      const avatarKey = await uploadAvatar.mutateAsync({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      await saveProfile.mutateAsync({ avatar_key: avatarKey });
    } catch (cause) {
      setPhotoError(
        cause instanceof Error
          ? cause.message
          : 'That photo could not be saved. Try again.',
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

  if (isPending) {
    return (
      <ScreenContainer>
        <PageHeader title="Profile" />
        <LoadingState />
      </ScreenContainer>
    );
  }

  const usage = describeUsage(musician?.usage ?? null);

  if (isError || !musician) {
    return (
      <ScreenContainer>
        <PageHeader title="Profile" />
        <EmptyState
          title="Couldn't load your account"
          description={describeLoadError(error)}
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
          accessibilityLabel={photoBusy ? 'Changing photo' : 'Change photo'}
          style={({ pressed }) => (pressed ? styles.pressed : undefined)}
        >
          <Avatar source={photoPreview ?? musician.avatarUrl} size={AVATAR_SIZE} />
        </Pressable>

        <Text variant="body" style={styles.identityEmail} numberOfLines={2}>
          {musician.email}
        </Text>
      </View>

      <Text
        variant="metadataSmall"
        color={photoError ? 'textSecondary' : 'textTertiary'}
        style={styles.photoNote}
      >
        {photoError
          ? photoError
          : photoBusy
            ? 'Saving your photo…'
            : 'Choose your photo to change it.'}
      </Text>

      <SectionHeader label="Account" style={styles.section} />
      <Card padded={false}>
        <View style={styles.rows}>
          <AccountRow
            label="Plan"
            value={formatTier(musician.tier)}
            divided={false}
          />
          <AccountRow label="Role" value={formatRole(musician.role)} />
          {/*
            The quota, before it is ever hit. `/v1/me` has carried this all
            along and nothing read it, so the only way to learn about the limit
            was to be refused by it — right after playing something. The
            backend's own note on `UsageResponse` says as much: "a paywall that
            only appears at the moment of refusal is a paywall that ambushes
            someone who has just finished playing."

            Absent for unlimited tiers, and absent when the server didn't
            report it — that is "unknown", not "unlimited", and a row saying
            either would be a guess.
          */}
          {usage ? <AccountRow label="Analyses" value={usage} /> : null}
          {/*
            The studio's name isn't on `/v1/me` — only its id, which means
            nothing to the person reading it. Confirm the membership and leave
            the row out entirely for the musicians who have none.
          */}
          {musician.studioId ? (
            <AccountRow label="Studio" value="Connected" />
          ) : null}
          <LinkRow
            label="Email"
            value={musician.email}
            onPress={() => navigation.navigate('ChangeEmail')}
          />
          <LinkRow
            label="Password"
            onPress={() => navigation.navigate('ChangePassword')}
          />
        </View>
      </Card>

      <SectionHeader label="Practice" style={styles.section} />
      <Card style={styles.settingCard}>
        <Text variant="button">Instrument</Text>
        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.settingNote}
        >
          Sets the clef and range of the daily excerpt on Today.
        </Text>

        <SegmentedControl
          label="Instrument"
          options={INSTRUMENT_OPTIONS}
          value={settings.instrument}
          onChange={(instrument: Instrument) =>
            preferences.setInstrument(instrument)
          }
          style={styles.control}
        />
      </Card>

      <Card>
        <Text variant="button">Metronome</Text>
        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.settingNote}
        >
          How the beat is marked while you record.
        </Text>

        <SegmentedControl
          label="Metronome"
          options={METRONOME_OPTIONS}
          value={settings.metronomeMode}
          onChange={(mode: MetronomeMode) => preferences.setMetronomeMode(mode)}
          style={styles.control}
        />

        {settings.metronomeMode === 'audio_with_headphones' ? (
          <Text
            variant="metadataSmall"
            color="textTertiary"
            style={styles.settingNote}
          >
            Use headphones — a metronome over the speaker ends up in the
            recording and throws the analysis off. This is the take only; the
            count-in always ticks, and is discarded before anything is sent.
          </Text>
        ) : null}
      </Card>

      <SectionHeader label="Preferences" style={styles.section} />
      <Card padded={false}>
        <View style={styles.rows}>
          <ToggleRow
            label="Haptic feedback"
            description="A short tap when a button or the shutter responds."
            value={settings.haptics}
            onChange={preferences.setHaptics}
            divided={false}
          />
          <ToggleRow
            label="Reduce motion"
            description="Hold back animation. Already on if your device asks for it."
            value={settings.reduceMotion}
            onChange={preferences.setReduceMotion}
          />
        </View>
      </Card>

      <SectionHeader label="Data & privacy" style={styles.section} />
      <Card padded={false}>
        <View style={styles.rows}>
          <LinkRow
            label="Download my data"
            divided={false}
            onPress={() => navigation.navigate('ExportData')}
          />
          <LinkRow
            label="Delete account"
            value="Permanent"
            onPress={() => navigation.navigate('DeleteAccount')}
          />
        </View>
      </Card>

      <SectionHeader label="About" style={styles.section} />
      <Card padded={false}>
        <View style={styles.rows}>
          <AccountRow
            label="Version"
            value={appConfig.expo.version}
            divided={false}
          />
          <LinkRow
            label="Help & connection"
            onPress={() => navigation.navigate('Help')}
          />
          <LinkRow
            label="Privacy"
            onPress={() => navigation.navigate('Legal', { document: 'privacy' })}
          />
          <LinkRow
            label="Terms"
            onPress={() => navigation.navigate('Legal', { document: 'terms' })}
          />
          <LinkRow
            label="Acknowledgements"
            onPress={() => navigation.navigate('Acknowledgements')}
          />
        </View>
      </Card>

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
 * mistakes it for a bass guitar. The full name is used everywhere it fits.
 */
const INSTRUMENT_OPTIONS = [
  { value: 'violin' as const, label: 'Violin' },
  { value: 'viola' as const, label: 'Viola' },
  { value: 'cello' as const, label: 'Cello' },
  { value: 'double_bass' as const, label: 'Bass' },
];

const METRONOME_OPTIONS = [
  { value: 'off' as const, label: 'Off' },
  { value: 'visual' as const, label: 'Visual' },
  { value: 'haptic' as const, label: 'Haptic' },
  { value: 'audio_with_headphones' as const, label: 'Audio' },
];

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  photoNote: {
    marginTop: spacing.md,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  identityEmail: {
    flexShrink: 1,
  },
  settingCard: {
    marginBottom: spacing.md,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  rows: {
    paddingHorizontal: spacing.lg,
  },
  settingNote: {
    marginTop: spacing.xs,
  },
  control: {
    marginTop: spacing.lg,
  },
  signOut: {
    marginTop: spacing['2xl'],
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
