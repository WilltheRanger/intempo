import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Card,
  EmptyState,
  LoadingState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { signOut } from '../../data/auth/session';
import { useMe } from '../../data/hooks/useMe';
import { spacing } from '../../design';
import { formatRole, formatTier } from '../../lib/format';
import { AccountRow } from './AccountRow';

/**
 * The signed-in account.
 *
 * Everything on this screen comes from `GET /v1/me` — email, tier, role, and
 * studio membership are the whole of what the backend knows about a user, and
 * the screen is deliberately the size of that. Practice statistics belong to
 * Insights, and there is no settings store to put preferences in, so inventing
 * either here would mean shipping rows that lead nowhere.
 */
export function ProfileScreen() {
  const { data: musician, isPending, isError } = useMe();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

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

      <Card padded={false}>
        <View style={styles.rows}>
          <AccountRow label="Email" value={musician.email} divided={false} />
          <AccountRow label="Plan" value={formatTier(musician.tier)} />
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

const styles = StyleSheet.create({
  rows: {
    paddingHorizontal: spacing.lg,
  },
  signOut: {
    marginTop: spacing['2xl'],
  },
  error: {
    marginTop: spacing.md,
  },
});
