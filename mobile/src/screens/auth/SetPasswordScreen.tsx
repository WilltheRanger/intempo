import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import {
  Input,
  RevealPasswordAction,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { signOut, updatePassword } from '../../data/auth/session';
import { spacing } from '../../design';
import { describeAuthError, validateNewPassword } from './authErrors';

/**
 * Setting a new password after following a reset link.
 *
 * **The screen the reset link never had.** Requesting a reset told the musician
 * "a link to set a new password is on its way" and the link landed on a
 * Supabase page, because no redirect was given and nothing in the app could
 * have handled the return. Now the link comes back here.
 *
 * **No current-password field**, unlike `ChangePasswordScreen`. That screen
 * asks for the old one because it is reachable from an unlocked phone left on a
 * music stand, and the session alone is not proof of the owner. Here the proof
 * is the link: it went to the address on the account, and following it is the
 * thing being trusted. Asking for the password would also be absurd — not
 * knowing it is why they are here.
 *
 * The session is live at this point, so leaving without setting a password
 * would silently sign someone in on the strength of an emailed link. "Cancel"
 * signs out rather than dropping them into the app.
 */
export function SetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * **Shared by both fields, and this screen had no reveal at all.** It is
   * where someone who has just followed a reset link types a brand-new
   * password twice on a phone keyboard with no way to check either — the
   * screen a Show control helps most, and the only one of the three without
   * it.
   */
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const complaint = validateNewPassword(password, repeated);
    if (complaint) {
      setError(complaint);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // `USER_UPDATED` follows this, which is what ends the recovering state
      // and lets the app through to Today — no navigation needed here.
      await updatePassword(password);
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenContainer>
        <View style={styles.header}>
          <Text variant="screenTitle">Set a new password</Text>
          <Text variant="body" color="textSecondary" style={styles.lede}>
            You followed a reset link, so this replaces the old password. You
            will stay signed in on this device.
          </Text>
        </View>

        <Input
          label="New password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!revealed}
          action={
            <RevealPasswordAction
              revealed={revealed}
              onPress={() => setRevealed((shown) => !shown)}
            />
          }
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!busy}
          style={styles.field}
        />

        <Input
          label="Repeat new password"
          value={repeated}
          onChangeText={setRepeated}
          secureTextEntry={!revealed}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          editable={!busy}
          style={styles.field}
        />

        {error ? (
          <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <PrimaryButton
          label="Set password"
          onPress={() => void submit()}
          loading={busy}
          disabled={busy}
          style={styles.submit}
        />

        <SecondaryButton
          label="Cancel"
          onPress={() => void signOut()}
          style={styles.cancel}
        />
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    marginTop: spacing['2xl'],
  },
  lede: {
    marginTop: spacing.md,
  },
  field: {
    marginTop: spacing.xl,
  },
  error: {
    marginTop: spacing.lg,
  },
  submit: {
    marginTop: spacing['2xl'],
  },
  cancel: {
    marginTop: spacing.md,
  },
});
