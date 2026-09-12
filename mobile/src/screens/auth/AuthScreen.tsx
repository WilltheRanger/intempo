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
  RevealPasswordAction,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import {
  requestPasswordReset,
  resendConfirmation,
  sendSignInLink,
  signIn,
  signUp,
} from '../../data/auth/session';
import {
  clearAuthRedirectNotice,
  useAuthRedirectNotice,
} from '../../data/auth/redirectNotice';
import { MIN_TOUCH_TARGET, spacing } from '../../design';
import {
  describeAuthError,
  needsPassword,
  validate,
  type AuthMode,
} from './authErrors';
import { LegalDocumentView } from '../legal/LegalScreen';
import { SIGN_UP_DOCUMENTS } from './signUpDocuments';
import type { LegalDocument } from '../../lib/legal';

/** What the screen is waiting on the musician's inbox for. */
type Sent = 'confirmation' | 'reset' | 'maybeExisting' | 'magicLink';

const COPY: Record<AuthMode, { lede: string; submit: string }> = {
  signIn: {
    lede: 'Sign in to reach your library and your practice history.',
    submit: 'Sign in',
  },
  signUp: {
    lede: 'Create an account to start building a library. We’ll email you a confirmation link.',
    submit: 'Create account',
  },
  reset: {
    lede: "Enter your address and we'll send a link to set a new password.",
    submit: 'Send reset link',
  },
  magicLink: {
    lede: "Enter your address and we'll send a link that signs you in. No password needed.",
    submit: 'Email me a link',
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
export interface AuthScreenProps {
  /**
   * Which form to open on. `signUp` is how `SignedOutFlow` comes back from
   * onboarding — the questions are answered, so the account form is what is
   * left, not the sign-in one somebody would have to switch away from again.
   */
  initialMode?: AuthMode;
  /**
   * Called instead of switching to the sign-up form.
   *
   * Onboarding runs **before** creating an account (2026-09-08), and this
   * screen is where that is asked for — so the flow above it takes the tap and
   * decides what comes first. Absent, the switch works as it always did, which
   * keeps this screen usable on its own.
   */
  onRequestSignUp?: () => void;
}

export function AuthScreen({
  initialMode = 'signIn',
  onRequestSignUp,
}: AuthScreenProps = {}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [resent, setResent] = useState(false);
  const [legalDocument, setLegalDocument] =
    useState<LegalDocument['id'] | null>(null);
  const redirectNotice = useAuthRedirectNotice();

  const showPassword = needsPassword(mode);
  const copy = COPY[mode];

  function go(next: AuthMode) {
    clearAuthRedirectNotice();
    setMode(next);
    setError(null);
  }

  async function submit() {
    clearAuthRedirectNotice();
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

      if (mode === 'magicLink') {
        await sendSignInLink(address);
        setSent('magicLink');
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
        // An address that already has an account lands here too, looking
        // identical — Supabase withholds the difference on purpose. Promising
        // a link that is never sent strands the musician, so this case gets
        // its own message rather than the confirmation one.
        setSent(result.possiblyAlreadyRegistered ? 'maybeExisting' : 'confirmation');
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

  if (legalDocument) {
    return (
      <LegalDocumentView
        documentId={legalDocument}
        onBack={() => setLegalDocument(null)}
        backLabel="Back to create account"
      />
    );
  }

  if (sent) {
    return (
      <ScreenContainer contentStyle={[styles.centred, styles.authColumn]}>
        <View>
          {/*
            "Check your email" contradicts the line below it when no mail was
            sent, which is exactly the case this state exists to describe.
          */}
          <Text variant="screenTitle">
            {sent === 'maybeExisting'
              ? 'Check your email — or sign in'
              : 'Check your email'}
          </Text>
          <Text variant="body" color="textSecondary" style={styles.lede}>
            {sent === 'magicLink'
              ? `A link that signs you in is on its way to ${email.trim()}. It expires in an hour, and opening it on this device is the quickest way back.`
              : sent === 'reset'
              ? `If there's an account for ${email.trim()}, a link to set a new password is on its way.`
              : sent === 'maybeExisting'
                ? `If ${email.trim()} is new, a confirmation link is on its way. If it already has an account, no mail is sent — sign in instead, or reset the password.`
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
            style={({ pressed }) => [
              styles.target,
              styles.switch,
              pressed && styles.switchPressed,
            ]}
          >
            <Text variant="sectionAction" color="textPrimary">
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
      <ScreenContainer contentStyle={[styles.centred, styles.authColumn]}>
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
            returnKeyType={showPassword ? 'next' : 'go'}
            onSubmitEditing={showPassword ? undefined : () => void submit()}
            editable={!busy}
            style={styles.field}
          />

          {showPassword ? (
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
                <RevealPasswordAction
                  revealed={revealed}
                  onPress={() => setRevealed((shown) => !shown)}
                />
              }
              style={styles.field}
            />
          ) : null}

          {mode === 'signIn' ? (
            <View style={styles.signInLinks}>
              <Pressable
                onPress={() => go('magicLink')}
                accessibilityRole="button"
                accessibilityLabel="Email me a sign-in link instead"
                style={({ pressed }) => [
                  styles.target,
                  pressed ? styles.switchPressed : undefined,
                ]}
              >
                <Text variant="sectionAction" color="textPrimary">
                  Email me a link
                </Text>
              </Pressable>

              <Pressable
                onPress={() => go('reset')}
                accessibilityRole="button"
                accessibilityLabel="Forgot your password"
                style={({ pressed }) => [
                  styles.target,
                  pressed ? styles.switchPressed : undefined,
                ]}
              >
                <Text variant="sectionAction" color="textPrimary">
                  Forgot your password?
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/*
            A way back to the password form. Both link modes are reached from
            sign-in, so without this the only exit is the account switcher at
            the foot, which says the wrong thing.
          */}
          {mode === 'magicLink' || mode === 'reset' ? (
            <Pressable
              onPress={() => go('signIn')}
              accessibilityRole="button"
              accessibilityLabel="Use a password instead"
              style={({ pressed }) => [
                styles.target,
                styles.forgot,
                pressed && styles.switchPressed,
              ]}
            >
              <Text variant="sectionAction" color="textPrimary">
                Use a password instead
              </Text>
            </Pressable>
          ) : null}

          {mode === 'signUp' ? (
            <View style={styles.legal}>
              <Text variant="metadataSmall" color="textSecondary">
                Before creating an account, you can review how InTempo handles
                your data and the terms for using it.
              </Text>
              <View style={styles.legalLinks}>
                {SIGN_UP_DOCUMENTS.map((document) => (
                  <Pressable
                    key={document.id}
                    onPress={() => setLegalDocument(document.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Read ${document.label}`}
                    style={({ pressed }) => [
                      styles.target,
                      styles.legalLink,
                      pressed && styles.switchPressed,
                    ]}
                  >
                    <Text variant="sectionAction" color="textPrimary">
                      {document.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {(error ?? redirectNotice) ? (
            <Text
              variant="metadataSmall"
              color="textSecondary"
              style={styles.error}
            >
              {error ?? redirectNotice}
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
          onPress={() => {
            if (mode !== 'signUp' && onRequestSignUp) {
              clearAuthRedirectNotice();
              onRequestSignUp();
              return;
            }
            go(mode === 'signUp' ? 'signIn' : 'signUp');
          }}
          accessibilityRole="button"
          accessibilityLabel={
            mode === 'signUp' ? 'Sign in instead' : 'Create an account'
          }
          style={({ pressed }) => [
            styles.target,
            styles.switch,
            pressed && styles.switchPressed,
          ]}
        >
          <Text variant="metadata" color="textSecondary">
            {mode === 'signUp'
              ? 'Already have an account? '
              : 'New to InTempo? '}
            <Text variant="metadata" color="textPrimary">
              {mode === 'signUp' ? 'Sign in' : 'Create an account'}
            </Text>
          </Text>
        </Pressable>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  /**
   * Padded to a real touch target, not `hitSlop`-ed to one.
   *
   * **`hitSlop` does nothing on the web build**, which is where these controls
   * are reached today. Measured in Chromium: a click 8pt above a control with
   * a 12pt slop did not activate it, while a click on its visible 18pt box
   * did. Every link on the sign-in screen was one line of type — under half
   * the platform minimum — with a hit area that existed only on device.
   */
  target: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
  },
  // A readable desktop measure. On phones the available width is smaller than
  // this, so the screen keeps the normal gutter and loses no space. On web it
  // stops labels, fields, and the primary action spanning the whole window.
  authColumn: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  // The two things you can ask for from the sign-in form, on one line: a link
  // instead of a password, and a link because you have forgotten it.
  signInLinks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
    marginTop: spacing.lg,
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
  legal: {
    marginTop: spacing.xl,
  },
  legalLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  legalLink: {
    justifyContent: 'center',
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
