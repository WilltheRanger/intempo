import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useGoBack } from '../../navigation/useGoBack';

import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import {
  Input,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { deleteAccount } from '../../data/account';
import { spacing } from '../../design';

/**
 * Permanent account deletion, kept out of Profile so the consequence has room
 * to be read before the destructive control is reached.
 */
export function DeleteAccountScreen() {
  const goBack = useGoBack({ tab: 'Profile' });
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = confirmation.trim().toUpperCase() === 'DELETE';

  async function removeAccount() {
    setConfirming(false);
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      // The auth listener replaces the signed-in tree. Drop every account-
      // scoped response immediately so another sign-in cannot see this one.
      queryClient.clear();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your account could not be deleted. Try again.',
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <ScreenContainer>
      <PageHeader
        title="Delete account"
        onBack={goBack}
        backLabel="Back to profile"
      />

      {/* One line where there was a line, a boxed list and the same warning
          again in the dialog (the owner's sweep, 2026-09-29). */}
      <Text variant="body" color="textSecondary" style={styles.lede}>
        Your pieces and recordings go with it.
      </Text>

      <Input
        label="Type DELETE to confirm"
        value={confirmation}
        onChangeText={setConfirmation}
        autoCapitalize="characters"
        editable={!deleting}
        style={styles.input}
      />

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <PrimaryButton
        label="Delete account"
        onPress={() => setConfirming(true)}
        disabled={!ready || deleting}
        loading={deleting}
        style={styles.delete}
      />


      <ConfirmDialog
        visible={confirming}
        title="Delete everything?"
        message="Your profile, library, recordings, and practice history will be permanently removed. There is no undo."
        confirmLabel="Delete forever"
        onConfirm={() => void removeAccount()}
        onCancel={() => setConfirming(false)}
      />
    </ScreenContainer>
  );
}


const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.md,
  },
  input: {
    marginTop: spacing['2xl'],
  },
  error: {
    marginTop: spacing.lg,
  },
  delete: {
    marginTop: spacing['2xl'],
  },

});
