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
import {
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signUp,
} from '../../data/auth/session';
import { spacing } from '../../design';
import { describeAuthError, validate, type AuthMode } from './authErrors';

/** What the screen is waiting on the musician's inbox for. */
type Sent = 'confirmation' | 'reset';

const COPY: Record<AuthMode, { lede: string; submit: string }> = {
  signIn: {
    lede: 'Sign in to reach your library and your practice history.',
    submit: 'Sign in',
  },
  signUp: {
    lede: 'Create an account to start building a library.',
    submit: 'Create account',
  },
  reset: {
    lede: "Enter your address and we'll send a link to set a new password.",
    submit: 'Send reset link',
  },
};

/**
 * Sign in, create an account, or ask for a password reset.
 *
 * One screen for all three, because they differ by a verb, a line of copy, and
 * whether the password field is there — separate screens would be the same
 * form reached by a push and a pop.
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
  const [sent, setSent] = useState<Sent | null>(null);
  const [resent, setResent] = useState(false);

  const needsPassword = mode !== 'reset';
  const copy = COPY[mode];

  function go(next: AuthMode) {
    setMode(next);
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
    const address = email.trim();
    try {
      if (mode === 'reset') {
        await requestPasswordReset(address);
        setSent('reset');
        return;
      }

      const result =
        mode === 'signIn'
          ? await signIn(address, password)
          : await signUp(address, password);

      // A sign-up against a project that confirms addresses returns no
      // session. Saying "welcome" here and then showing the form again would
      // read as a failure; what actually happened is that mail is on its way.
      if (result.awaitingConfirmation) {
        setSent('confirmation');
        setPassword('');
      }
      // Otherwise the auth listener swaps this screen out. Nothing to do.
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await resendConfirmation(email.trim());
      setResent(true);
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <ScreenContainer contentStyle={styles.centred}>
        <View>
          <Text variant="screenTitle">Check your email</Text>
          <Text variant="body" color="textSecondary" style={styles.lede}>
            {sent === 'reset'
              ? `If there's an account for ${email.trim()}, a link to set a new password is on its way.`
              : `We sent a confirmation link to ${email.trim()}. Follow it and you'll be signed in.`}
          </Text>

          {error ? (
            <Text
              variant="metadataSmall"
              color="textSecondary"
              style={styles.error}
            >
              {error}
            </Text>
          ) : null}

          {/*
            The mail that never arrives is the commonest way an account stalls,
            and there is nowhere else to ask for another one.
          */}
          {sent === 'confirmation' ? (
            <Text
              variant="metadataSmall"
              color="textTertiary"
              style={styles.error}
            >
              {resent
                ? 'Sent again. It can take a minute to arrive.'
                : "Didn't get it? Check spam, or send it again."}
            </Text>
          ) : null}
        </View>

        <View>
          {sent === 'confirmation' && !resent ? (
            <PrimaryButton
              label="Send it again"
              onPress={() => void resend()}
              loading={busy}
              style={styles.submit}
            />
          ) : null}

          <Pressable
            onPress={() => {
              setSent(null);
              setResent(false);
              go('signIn');
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
        </View>
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
            {copy.lede}
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
            returnKeyType={needsPassword ? 'next' : 'go'}
            onSubmitEditing={needsPassword ? undefined : () => void submit()}
            editable={!busy}
            style={styles.field}
          />

          {needsPassword ? (
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!revealed}
              autoCapitalize="none"
              // Tells the keychain to offer a saved password on sign-in and to
              // suggest a strong one on sign-up.
              autoComplete={
                mode === 'signIn' ? 'current-password' : 'new-password'
              }
              textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
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
          ) : null}

          {mode === 'signIn' ? (
            <Pressable
              onPress={() => go('reset')}
              accessibilityRole="button"
              accessibilityLabel="Forgot your password"
              hitSlop={spacing.sm}
              style={({ pressed }) => [
                styles.forgot,
                pressed && styles.switchPressed,
              ]}
            >
              <Text variant="sectionAction" color="accent">
                Forgot your password?
              </Text>
            </Pressable>
          ) : null}

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
            label={copy.submit}
            onPress={() => void submit()}
            loading={busy}
            style={styles.submit}
          />
        </View>

        <Pressable
          onPress={() => go(mode === 'signUp' ? 'signIn' : 'signUp')}
          accessibilityRole="button"
          accessibilityLabel={
            mode === 'signUp' ? 'Sign in instead' : 'Create an account'
          }
          hitSlop={spacing.md}
          style={({ pressed }) => [
            styles.switch,
            pressed && styles.switchPressed,
          ]}
        >
          <Text variant="metadata" color="textSecondary">
            {mode === 'signUp'
              ? 'Already have an account? '
              : 'New to InTempo? '}
            <Text variant="metadata" color="accent">
              {mode === 'signUp' ? 'Sign in' : 'Create an account'}
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
  forgot: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
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
