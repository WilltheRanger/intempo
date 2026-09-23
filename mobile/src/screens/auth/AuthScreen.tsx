import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import {
  Input,
  PrimaryButton,
  RevealPasswordAction,
  Text,
} from '../../components/primitives';
import { SCREEN_GUTTER } from '../../components/primitives/ScreenContainer';
import {
  type AuthResult,
  hasSession,
  requestPasswordReset,
  resendConfirmation,
  sendSignInLink,
  signIn,
  signUp,
} from '../../data/auth/session';
import { ATTEMPT_STALLED, settleAuthCall } from './authAttempt';
import {
  clearAuthRedirectNotice,
  useAuthRedirectNotice,
} from '../../data/auth/redirectNotice';
import { colors, fontFamily, MIN_TOUCH_TARGET, spacing } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';
import {
  describeAuthError,
  needsPassword,
  validate,
  type AuthMode,
} from './authErrors';
import { LegalDocumentView } from '../legal/LegalScreen';
import { SIGN_UP_DOCUMENTS } from './signUpDocuments';
import type { LegalDocument } from '../../lib/legal';
import { signInWash } from './signInWash';

/** What the screen is waiting on the musician's inbox for. */
type Sent = 'confirmation' | 'reset' | 'maybeExisting' | 'magicLink';

/**
 * The redesign's words for each form (`redesign/SignIn.dc.html`). It drew
 * two; the link and the reset forms are the same frame with their own verb.
 * "Create your account" has no lede in the prototype — the questions before
 * it have already said what the app is.
 */
const COPY: Record<AuthMode, { title: string; lede: string | null; submit: string }> = {
  signIn: {
    title: 'Welcome back',
    lede: 'Your library and your practice history are where you left them.',
    submit: 'Sign in',
  },
  signUp: {
    title: 'Create your account',
    lede: null,
    submit: 'Create account',
  },
  reset: {
    title: 'Reset your password',
    lede: "Enter your address and we'll send a link to set a new password.",
    submit: 'Send reset link',
  },
  magicLink: {
    title: 'Sign in with a link',
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
  /** Whether the change of form now under way holds on the photograph. */
  const [beat, setBeat] = useState(false);
  const redirectNotice = useAuthRedirectNotice();

  const showPassword = needsPassword(mode);
  const copy = COPY[mode];

  function go(next: AuthMode) {
    clearAuthRedirectNotice();
    setBeat(false);
    setMode(next);
    setError(null);
  }

  /** Between signing in and creating an account: the other door. */
  function switchPanel(next: 'signIn' | 'signUp') {
    clearAuthRedirectNotice();
    setBeat(true);
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

    // `settleAuthCall` rather than a bare `await`: Supabase throws out of a
    // sign-in for things that happen *after* the session is granted, and
    // nothing bounds how long the call may take. Both used to reach the
    // musician as a form that had refused them. See `authAttempt.ts`.
    const settled = await settleAuthCall<'reset' | 'magicLink' | AuthResult>({
      run: () => {
        if (mode === 'reset') {
          return requestPasswordReset(address).then(() => 'reset' as const);
        }
        if (mode === 'magicLink') {
          return sendSignInLink(address).then(() => 'magicLink' as const);
        }
        return mode === 'signIn'
          ? signIn(address, password)
          : signUp(address, password);
      },
      signedIn: hasSession,
    });
    setBusy(false);

    // Signed in despite the throw, or despite the wait: the auth listener has
    // already replaced this screen, and an error under it would be a lie about
    // the thing that just worked.
    if (settled.kind === 'signedIn') {
      return;
    }
    if (settled.kind === 'stalled') {
      setError(ATTEMPT_STALLED);
      return;
    }
    if (settled.kind === 'failed') {
      setError(describeAuthError(settled.error));
      return;
    }

    const result = settled.value;
    if (result === 'reset' || result === 'magicLink') {
      setSent(result);
      return;
    }

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
  }

  async function resend() {
    setBusy(true);
    setError(null);
    // No `signedIn`: another confirmation mail either goes out or does not, and
    // a session says nothing about which. The deadline is the point here — this
    // button is the last thing a stranded musician has, and one that spins for
    // ever is worse than one that says to try again.
    const settled = await settleAuthCall({
      run: () => resendConfirmation(email.trim()),
    });
    setBusy(false);

    if (settled.kind === 'stalled') {
      setError(ATTEMPT_STALLED);
      return;
    }
    if (settled.kind === 'failed') {
      setError(describeAuthError(settled.error));
      return;
    }
    setResent(true);
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
      <SignInFrame panelKey={`sent-${sent}`}>
        {/*
          "Check your email" contradicts the line below it when no mail was
          sent, which is exactly the case this state exists to describe.
        */}
        <Text variant="screenTitle" accessibilityRole="header">
          {sent === 'maybeExisting' ? 'Check your email, or sign in' : 'Check your email'}
        </Text>
        <Text variant="body" color="textSecondary" style={styles.lede}>
          {sent === 'magicLink'
            ? `A link that signs you in is on its way to ${email.trim()}. It expires in an hour, and opening it on this device is the quickest way back.`
            : sent === 'reset'
              ? `If there's an account for ${email.trim()}, a link to set a new password is on its way.`
              : sent === 'maybeExisting'
                ? `If ${email.trim()} is new, a confirmation link is on its way. If it already has an account, no mail is sent. Sign in instead, or reset the password.`
                : `We sent a confirmation link to ${email.trim()}. Follow it and you'll be signed in.`}
        </Text>

        {error ? (
          <Text variant="metadataSmall" color="textSecondary" style={styles.note}>
            {error}
          </Text>
        ) : null}

        {/*
          The mail that never arrives is the commonest way an account stalls,
          and there is nowhere else to ask for another one.
        */}
        {sent === 'confirmation' ? (
          <Text variant="metadataSmall" color="textTertiary" style={styles.note}>
            {resent
              ? 'Sent again. It can take a minute to arrive.'
              : "Didn't get it? Check spam, or send it again."}
          </Text>
        ) : null}

        {sent === 'confirmation' && !resent ? (
          <PrimaryButton
            label="Send it again"
            onPress={() => void resend()}
            loading={busy}
            style={styles.submit}
          />
        ) : null}

        <SwitchLine
          lead=""
          action="Back to sign in"
          onPress={() => {
            setSent(null);
            setResent(false);
            go('signIn');
          }}
        />
      </SignInFrame>
    );
  }

  return (
    <SignInFrame panelKey={mode} beat={beat}>
      <Text variant="screenTitle" accessibilityRole="header">
        {copy.title}
      </Text>
      {copy.lede ? (
        <Text variant="body" color="textSecondary" style={styles.lede}>
          {copy.lede}
        </Text>
      ) : null}

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
        style={copy.lede ? styles.firstField : styles.firstFieldNoLede}
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
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          editable={!busy}
          actionInside
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
        // The two things you can ask for from the sign-in form, on one line:
        // a link instead of a password, and a link because you have forgotten it.
        <View style={styles.signInLinks}>
          <TextLink label="Email me a link" onPress={() => go('magicLink')} />
          <TextLink label="Forgot your password?" onPress={() => go('reset')} />
        </View>
      ) : null}

      {/*
        A way back to the password form. Both link modes are reached from
        sign-in, so without this the only exit is the switch at the foot, which
        says the wrong thing.
      */}
      {mode === 'magicLink' || mode === 'reset' ? (
        <View style={styles.signInLinks}>
          <TextLink label="Use a password instead" onPress={() => go('signIn')} />
        </View>
      ) : null}

      {mode === 'signUp' ? (
        <View style={styles.legal} accessibilityRole="text">
          <Text variant="caption" color="textTertiary" style={styles.legalText}>
            Creating an account means you accept the{' '}
          </Text>
          {SIGN_UP_DOCUMENTS.map((document, index) => (
            <View key={document.id} style={styles.legalPiece}>
              <InlineLink
                label={document.label}
                onPress={() => setLegalDocument(document.id)}
              />
              <Text variant="caption" color="textTertiary" style={styles.legalText}>
                {index < SIGN_UP_DOCUMENTS.length - 1 ? ' and the ' : '.'}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {(error ?? redirectNotice) ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.note}>
          {error ?? redirectNotice}
        </Text>
      ) : null}

      <PrimaryButton
        label={copy.submit}
        onPress={() => void submit()}
        loading={busy}
        style={mode === 'signIn' || mode === 'signUp' ? styles.submitTight : styles.submit}
      />

      {mode === 'signUp' ? (
        <SwitchLine lead="Already have an account? " action="Sign in" onPress={() => switchPanel('signIn')} />
      ) : (
        <SwitchLine
          lead="New to InTempo? "
          action="Create an account"
          onPress={() => {
            if (onRequestSignUp) {
              clearAuthRedirectNotice();
              onRequestSignUp();
              return;
            }
            switchPanel('signUp');
          }}
        />
      )}
    </SignInFrame>
  );
}

/** How long the bare photograph holds between sign in and sign up. */
const BEAT_MS = 1500;
/** The form and the wash going. */
const OUT_MS = 360;
/** And coming back, a moment after the wash. */
const IN_MS = 460;

/**
 * The photograph, the ivory wash over it, the name, and a form standing on
 * the wash (`redesign/SignIn.dc.html`).
 *
 * **Switching between signing in and creating an account holds a beat on the
 * bare photograph**: the form and the wash go, the turntable is there alone
 * for a moment, and the other form arrives. The prototype's own choreography,
 * and deliberate — the one moment the app shows its picture uncovered is the
 * moment the musician changes their mind about which door they came in by.
 * Every other change of form (a link instead of a password, a reset) is a
 * plain crossfade: they are the same door. Reduce Motion gets quick fades and
 * no beat.
 */
function SignInFrame({
  panelKey,
  beat = false,
  children,
}: {
  panelKey: string;
  beat?: boolean;
  children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [columnTop, setColumnTop] = useState<number | null>(null);
  const [panelTop, setPanelTop] = useState(0);
  // The form's title, not the brand over it: the prototype lets the name sit
  // on the last of the fade and stands the title on solid ground.
  const formTop = columnTop === null ? null : columnTop + panelTop;
  const [shown, setShown] = useState<{ key: string; children: ReactNode }>({
    key: panelKey,
    children,
  });
  const panel = useRef(new Animated.Value(1)).current;
  const wash = useRef(new Animated.Value(1)).current;
  const native = Platform.OS !== 'web';

  // The same form re-rendering (typing, an error arriving) passes straight
  // through; only a change of form is animated.
  const current = shown.key === panelKey ? children : shown.children;

  useEffect(() => {
    if (shown.key === panelKey) {
      return;
    }
    const fade = (value: Animated.Value, toValue: number, duration: number, delay = 0) =>
      Animated.timing(value, {
        toValue,
        duration: reduceMotion ? 140 : duration,
        delay: reduceMotion ? 0 : delay,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: native,
      });
    const holding = beat && !reduceMotion;
    const sequence = Animated.sequence([
      Animated.parallel([
        fade(panel, 0, OUT_MS),
        ...(holding ? [fade(wash, 0, OUT_MS)] : []),
      ]),
      ...(holding ? [Animated.delay(BEAT_MS)] : []),
    ]);
    sequence.start(({ finished }) => {
      if (!finished) {
        return;
      }
      setShown({ key: panelKey, children });
      Animated.parallel([
        ...(holding ? [fade(wash, 1, 420)] : []),
        fade(panel, 1, IN_MS, holding ? 260 : 0),
      ]).start();
    });
    return () => sequence.stop();
    // `children` is read at the moment the old form has gone, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelKey]);

  const stops = signInWash(height, formTop);

  return (
    <View style={styles.screen}>
      <Image
        source={SIGN_IN_PHOTO}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        contentPosition="center"
        accessible={false}
      />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: wash }]} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="sign-in-wash" x1="0" y1="0" x2="0" y2="1">
              {stops.map(([offset, opacity]) => (
                <Stop key={offset} offset={offset} stopColor={colors.bg} stopOpacity={opacity} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill="url(#sign-in-wash)" />
        </Svg>
      </Animated.View>

      <KeyboardAvoidingView
        style={styles.flex}
        // The form sits low on the screen; without this the password field
        // ends up under the keyboard.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={styles.column}
            onLayout={(event) => setColumnTop(event.nativeEvent.layout.y)}
          >
            <Animated.View style={{ opacity: wash }}>
              <Text style={styles.brand}>InTempo</Text>
            </Animated.View>
            <Animated.View
              style={[styles.panel, { opacity: panel }]}
              onLayout={(event) => setPanelTop(event.nativeEvent.layout.y)}
            >
              {current}
            </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** A link-coloured word at a full touch target: "Email me a link". */
function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.target, pressed && styles.pressed]}
    >
      <Text variant="metadata" color="accentText">
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A link inside a sentence, with a touch target taller than its line.
 *
 * The sentence is set at 17pt leading and a target has to be 44, so the
 * target reaches above and below the line it sits in rather than pushing the
 * lines apart — which is what the sentence as the redesign drew it needs, and
 * what `hitSlop` would do on a phone and does not do at all on the web.
 */
function InlineLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Read the ${label}`}
      style={({ pressed }) => [styles.inlineTarget, pressed && styles.pressed]}
    >
      <Text variant="caption" color="accentText" style={styles.legalText}>
        {label}
      </Text>
    </Pressable>
  );
}

/** "New to InTempo? Create an account", and its opposite. */
function SwitchLine({
  lead,
  action,
  onPress,
}: {
  lead: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.switch}>
      {lead ? (
        <Text variant="metadata" color="textSecondary">
          {lead}
        </Text>
      ) : null}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.target, pressed && styles.pressed]}
      >
        <Text variant="metadata" color="accentText" style={styles.switchAction}>
          {action}
        </Text>
      </Pressable>
    </View>
  );
}

const SIGN_IN_PHOTO = require('../../../assets/hero/signin-hero.jpg');

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  // A phone's column, and on a wide window a readable one: the photograph
  // still fills the screen, and the form stays the width of a hand.
  column: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: SCREEN_GUTTER,
  },
  brand: {
    fontFamily: fontFamily.serifMedium,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.2,
    color: colors.textPrimary,
  },
  panel: {
    marginTop: 26,
  },
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
  inlineTarget: {
    minHeight: MIN_TOUCH_TARGET,
    // The target's extra height, taken back out of the line: 44 − 17, split.
    marginVertical: -13.5,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  lede: {
    marginTop: spacing.sm,
  },
  firstField: {
    marginTop: spacing.xl,
  },
  firstFieldNoLede: {
    marginTop: 26,
  },
  field: {
    marginTop: spacing.lg,
  },
  signInLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.xl,
    marginTop: spacing.sm,
  },
  legal: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 14,
  },
  legalPiece: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legalText: {
    fontSize: 12,
    lineHeight: 17,
  },
  note: {
    marginTop: spacing.lg,
  },
  submitTight: {
    marginTop: spacing.lg,
  },
  submit: {
    marginTop: spacing['2xl'],
  },
  switch: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  switchAction: {
    fontFamily: fontFamily.sansMedium,
  },
});
