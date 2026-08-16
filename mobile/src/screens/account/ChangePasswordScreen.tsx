import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {
  Input,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { signIn, updatePassword } from '../../data/auth/session';
import { useMe } from '../../data/hooks/useMe';
import { spacing } from '../../design';
import {
  describeAuthError,
  validateNewPassword,
} from '../auth/authErrors';

/**
 * Sets a new password on the signed-in account.
 *
 * The current password is asked for and checked, even though Supabase doesn't
 * require it — the session alone is enough for the API. Without the check, an
 * unlocked phone left on a music stand is enough to lock its owner out of
 * their own account, which is not a trade worth one fewer field.
 */
export function ChangePasswordScreen() {
  const navigation = useNavigation();
  const { data: musician } = useMe();

  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    const complaint = validateNewPassword(password, repeated);
    if (complaint) {
      setError(complaint);
      return;
    }
    if (!musician) {
      setError('Your account is still loading. Try again in a moment.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Proves the person holding the phone is the account's owner. A wrong
      // password throws here and nothing is changed.
      await signIn(musician.email, currentPassword);
      await updatePassword(password);
      setDone(true);
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <ScreenContainer>
        <PageHeader
          title="Password changed"
          onBack={() => navigation.goBack()}
          backLabel="Back to profile"
        />
        <Text variant="body" color="textSecondary">
          Use the new one next time you sign in. Other devices stay signed in.
        </Text>
        <SecondaryButton
          label="Done"
          onPress={() => navigation.goBack()}
          style={styles.done}
        />
      </ScreenContainer>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenContainer>
        <PageHeader
          title="Change password"
          onBack={() => navigation.goBack()}
          backLabel="Back to profile"
        />

        <View>
          <Input
            label="Current password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            editable={!busy}
          />

          <Input
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!revealed}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            editable={!busy}
            action={
              <RevealAction
                revealed={revealed}
                onPress={() => setRevealed((shown) => !shown)}
              />
            }
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
            <Text
              variant="metadataSmall"
              color="textSecondary"
              style={styles.error}
            >
              {error}
            </Text>
          ) : null}

          <PrimaryButton
            label="Change password"
            onPress={() => void submit()}
            loading={busy}
            style={styles.submit}
          />
        </View>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

/** Shared by both new-password fields, so one tap reveals the pair. */
function RevealAction({
  revealed,
  onPress,
}: {
  revealed: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
      hitSlop={spacing.md}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      <Text variant="sectionAction" color="accent">
        {revealed ? 'Hide' : 'Show'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  field: {
    marginTop: spacing.lg,
  },
  error: {
    marginTop: spacing.lg,
  },
  submit: {
    marginTop: spacing['2xl'],
  },
  done: {
    marginTop: spacing['2xl'],
  },
  pressed: {
    opacity: 0.6,
  },
});
