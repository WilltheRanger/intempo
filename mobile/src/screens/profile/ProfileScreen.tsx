import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import appConfig from '../../../app.json';
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
import { preferences, usePreferences } from '../../data/preferences';
import type { MetronomeMode } from '../../data/types';
import { spacing } from '../../design';
import { formatRole, formatTier } from '../../lib/format';
import { AccountRow } from './AccountRow';
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
  const { data: musician, isPending, isError } = useMe();
  const settings = usePreferences();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  // Tapping the photo is the affordance; the camera or pencil badge over it
  // waits until there's an upload behind it to justify the decoration.
  const [photoNote, setPhotoNote] = useState(false);

  async function handleSignOut() {
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

  if (isError || !musician) {
    return (
      <ScreenContainer>
        <PageHeader title="Profile" />
        <EmptyState
          title="Couldn't load your account"
          description="Check your connection and try again."
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
          onPress={() => setPhotoNote(true)}
          accessibilityRole="button"
          accessibilityLabel="Edit photo"
          style={({ pressed }) => (pressed ? styles.pressed : undefined)}
        >
          <Avatar source={musician.avatarUrl} size={AVATAR_SIZE} />
        </Pressable>

        <Text variant="body" style={styles.identityEmail} numberOfLines={2}>
          {musician.email}
        </Text>
      </View>

      {photoNote ? (
        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.photoNote}
        >
          Changing your photo isn&apos;t available yet.
        </Text>
      ) : null}

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
            The studio's name isn't on `/v1/me` — only its id, which means
            nothing to the person reading it. Confirm the membership and leave
            the row out entirely for the musicians who have none.
          */}
          {musician.studioId ? (
            <AccountRow label="Studio" value="Connected" />
          ) : null}
        </View>
      </Card>

      <SectionHeader label="Practice" style={styles.section} />
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
            recording and throws the analysis off.
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

      <SectionHeader label="About" style={styles.section} />
      <Card padded={false}>
        <View style={styles.rows}>
          <AccountRow
            label="Version"
            value={appConfig.expo.version}
            divided={false}
          />
        </View>
      </Card>

      <SecondaryButton
        label={signingOut ? 'Signing out…' : 'Sign out'}
        onPress={handleSignOut}
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
