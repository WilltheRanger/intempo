import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import {
  Card,
  Input,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { deleteAccount } from '../../data/account';
import { spacing } from '../../design';
import type { RootNavigation } from '../../navigation/types';

/**
 * Permanent account deletion, kept out of Profile so the consequence has room
 * to be read before the destructive control is reached.
 */
export function DeleteAccountScreen() {
  const navigation = useNavigation<RootNavigation>();
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
        onBack={() => navigation.goBack()}
        backLabel="Back to profile"
      />

      <Text variant="body" color="textSecondary" style={styles.lede}>
        This permanently removes your InTempo account and cannot be undone.
      </Text>

      <Card emphasis style={styles.card}>
        <Text variant="button">What will be removed</Text>
        <View style={styles.list}>
          <Bullet>your profile and photo</Bullet>
          <Bullet>every piece in your library</Bullet>
          <Bullet>practice recordings, timing results, and corrections</Bullet>
        </View>
      </Card>

      <Input
        label="Type DELETE to confirm"
        value={confirmation}
        onChangeText={setConfirmation}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!deleting}
        style={styles.input}
      />

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <PrimaryButton
        label="Delete account permanently"
        onPress={() => setConfirming(true)}
        disabled={!ready || deleting}
        loading={deleting}
        style={styles.delete}
      />

      <Text variant="metadataSmall" color="textTertiary" style={styles.note}>
        Signing out does not delete anything. Use the button above only when
        you want the account and its data removed.
      </Text>

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

function Bullet({ children }: { children: string }) {
  return (
    <View style={styles.bulletRow}>
      <Text variant="body" color="textSecondary">
        •
      </Text>
      <Text variant="body" color="textSecondary" style={styles.bulletCopy}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.md,
  },
  card: {
    marginTop: spacing['2xl'],
  },
  list: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bulletCopy: {
    flex: 1,
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
  note: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
