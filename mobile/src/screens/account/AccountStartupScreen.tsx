import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  LoadingState,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { describeLoadError } from '../../data/api/describeError';
import { signOut } from '../../data/auth/session';
import { spacing } from '../../design';

interface AccountStartupScreenProps {
  error?: unknown;
  retrying?: boolean;
  onRetry?: () => void;
}

/**
 * Holds the signed-in gate while the account is restored.
 *
 * Tabs are intentionally not mounted until `/v1/me` succeeds. Showing a
 * half-open app made a cold or failed backend look like four unrelated broken
 * screens, and let an account with unfinished onboarding slip around its gate.
 */
export function AccountStartupScreen({
  error,
  retrying = false,
  onRetry,
}: AccountStartupScreenProps) {
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function backToSignIn() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
      queryClient.clear();
    } catch {
      setSignOutError(
        "Couldn't return to sign in. Check your connection and try again.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  if (!error) {
    return (
      <ScreenContainer
        scrollable={false}
        contentStyle={[styles.screen, styles.centred]}
      >
        <View>
          <Text variant="screenTitle">Opening your practice space</Text>
          <Text variant="body" color="textSecondary" style={styles.lede}>
            Restoring your library, profile, and practice history.
          </Text>
          <LoadingState
            layout="inline"
            label="This can take a little longer after the app has been idle."
          />
        </View>
      </ScreenContainer>
    );
  }

  /*
    **The message sits where the eye lands; the actions sit where the thumb
    is.** Both were in one centred block, which put "Try again" — the only
    thing this screen exists to offer — at the vertical middle of the phone
    (measured: y=439 of 844). Everything on this screen is one decision, so
    §3 law 7 applies to it more here than almost anywhere else in the app.
  */
  return (
    <ScreenContainer scrollable={false} contentStyle={styles.screen}>
      <View style={styles.message}>
        <Text variant="screenTitle">Couldn&apos;t open your account</Text>
        <Text variant="body" color="textSecondary" style={styles.lede}>
          {describeLoadError(error)}
        </Text>
      </View>

      <View>
        <PrimaryButton
          label="Try again"
          onPress={onRetry ?? (() => {})}
          loading={retrying}
          disabled={!onRetry}
        />
        <SecondaryButton
          label={signingOut ? 'Returning to sign in…' : 'Back to sign in'}
          onPress={() => void backToSignIn()}
          disabled={signingOut || retrying}
          style={styles.secondary}
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
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centred: {
    justifyContent: 'center',
  },
  // Takes the space above the actions and centres the message in it, so the
  // words are not glued to the status bar and the buttons stay in reach.
  message: {
    flex: 1,
    justifyContent: 'center',
  },
  lede: {
    marginTop: spacing.md,
  },
  secondary: {
    marginTop: spacing.md,
  },
  error: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
