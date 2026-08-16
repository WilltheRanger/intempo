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
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { signIn, signUp } from '../../data/auth/session';
import { spacing } from '../../design';
import {
  describeAuthError,
  validate,
  type AuthMode,
} from './authErrors';

/**
 * Sign in, or create an account.
 *
 * One screen for both, because the two differ by a verb and a line of copy —
 * a second screen would be the same form with the same fields, and switching
 * between them would push and pop for no reason.
 *
 * The gate above this decides when it appears; it doesn't navigate anywhere on
 * success. Supabase emits the new session, `useAuthStatus` hears it, and the
 * app replaces this screen with the tabs. Nothing here has to know that.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(
    null,
  );

  const signingIn = mode === 'signIn';

  function switchMode() {
    setMode(signingIn ? 'signUp' : 'signIn');
    setError(null);
  }

  async function submit() {
    const complaint = validate(mode, email, password);
    if (complaint) {
      setError(complaint);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const address = email.trim();
      const result = signingIn
        ? await signIn(address, password)
        : await signUp(address, password);

      // A sign-up against a project that confirms addresses returns no
      // session. Saying "welcome" here and then showing the form again would
      // read as a failure; what actually happened is that mail is on its way.
      if (result.awaitingConfirmation) {
        setConfirmationSentTo(address);
        setPassword('');
      }
      // On success the auth listener swaps this screen out. Nothing to do.
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (confirmationSentTo) {
    return (
      <ScreenContainer contentStyle={styles.centred}>
        <View>
          <Text variant="screenTitle">Check your email</Text>
          <Text variant="body" color="textSecondary" style={styles.lede}>
            We sent a confirmation link to {confirmationSentTo}. Follow it and
            you&apos;ll be signed in.
          </Text>
        </View>

        <Pressable
          onPress={() => {
            setConfirmationSentTo(null);
            setMode('signIn');
          }}
          accessibilityRole="button"
          accessibilityLabel="Back to sign in"
          hitSlop={spacing.md}
          style={({ pressed }) => [
            styles.switch,
            pressed && styles.switchPressed,
          ]}
        >
          <Text variant="sectionAction" color="accent">
            Back to sign in
          </Text>
        </Pressable>
      </ScreenContainer>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      // The form sits low on the screen; without this the password field ends
      // up under the keyboard on shorter phones.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenContainer contentStyle={styles.centred}>
        <View>
          <Text variant="screenTitle">InTempo</Text>
          <Text variant="body" color="textSecondary" style={styles.lede}>
            {signingIn
              ? 'Sign in to reach your library and your practice history.'
              : 'Create an account to start building a library.'}
          </Text>

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            editable={!busy}
            style={styles.field}
          />

          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!revealed}
            autoCapitalize="none"
            // Tells the keychain to offer a saved password on sign-in and to
            // suggest a strong one on sign-up.
            autoComplete={signingIn ? 'current-password' : 'new-password'}
            textContentType={signingIn ? 'password' : 'newPassword'}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            editable={!busy}
            action={
              <Pressable
                onPress={() => setRevealed((shown) => !shown)}
                accessibilityRole="button"
                accessibilityLabel={
                  revealed ? 'Hide password' : 'Show password'
                }
                hitSlop={spacing.md}
                style={({ pressed }) =>
                  pressed ? styles.switchPressed : undefined
                }
              >
                <Text variant="sectionAction" color="accent">
                  {revealed ? 'Hide' : 'Show'}
                </Text>
              </Pressable>
            }
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
            label={signingIn ? 'Sign in' : 'Create account'}
            onPress={() => void submit()}
            loading={busy}
            style={styles.submit}
          />
        </View>

        <Pressable
          onPress={switchMode}
          accessibilityRole="button"
          accessibilityLabel={
            signingIn ? 'Create an account' : 'Sign in instead'
          }
          hitSlop={spacing.md}
          style={({ pressed }) => [
            styles.switch,
            pressed && styles.switchPressed,
          ]}
        >
          <Text variant="metadata" color="textSecondary">
            {signingIn ? 'New to InTempo? ' : 'Already have an account? '}
            <Text variant="metadata" color="accent">
              {signingIn ? 'Create an account' : 'Sign in'}
            </Text>
          </Text>
        </Pressable>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // The form is the whole screen; centring stops it clinging to the top.
  centred: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  lede: {
    marginTop: spacing.md,
    marginBottom: spacing['3xl'],
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
  switch: {
    marginTop: spacing['3xl'],
    alignItems: 'center',
  },
  switchPressed: {
    opacity: 0.6,
  },
});
