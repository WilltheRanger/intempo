import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useGoBack } from '../../navigation/useGoBack';
import type { RootStackParamList } from '../../navigation/types';
import { EMAIL_CHANGE_HALFWAY } from '../../data/auth/emailChange';

import {
  Input,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { updateEmail } from '../../data/auth/session';
import { useMe } from '../../data/hooks/useMe';
import { spacing } from '../../design';
import { describeAuthError, isEmail } from '../auth/authErrors';

/**
 * Moves the account to a different address.
 *
 * Nothing changes when this returns: Supabase mails the new address and waits
 * for the link to be followed. Reporting it done would leave someone thinking
 * their address had moved when it hadn't, so the screen says what actually
 * happened and where to look.
 */
export function ChangeEmailScreen() {
  const goBack = useGoBack({ tab: 'Profile' });
  const { data: musician } = useMe();
  const { params } = useRoute<RouteProp<RootStackParamList, 'ChangeEmail'>>();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit() {
    const address = email.trim();
    if (!address) {
      setError('Enter the new address.');
      return;
    }
    if (!isEmail(address)) {
      setError("That doesn't look like an email address.");
      return;
    }
    if (address.toLowerCase() === musician?.email.toLowerCase()) {
      setError('That is already your address.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await updateEmail(address);
      setSentTo(address);
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (params?.halfway) {
    // The first of the two links came back (`isEmailChangeHalfway`): said
    // here, on the screen the change began on, rather than nowhere.
    return (
      <ScreenContainer>
        <PageHeader
          title="Confirm the change"
          onBack={goBack}
          backLabel="Back to profile"
        />
        <Text variant="body" color="textSecondary">
          {EMAIL_CHANGE_HALFWAY}
        </Text>
        <SecondaryButton
          label="Done"
          onPress={goBack}
          style={styles.done}
        />
      </ScreenContainer>
    );
  }

  if (sentTo) {
    return (
      <ScreenContainer>
        <PageHeader
          title="Confirm the change"
          onBack={goBack}
          backLabel="Back to profile"
        />
        {/*
          True with Supabase's "Secure email change" on (its default: a link
          to each address) and off (one link, to the new one) alike — which
          the live project has is a dashboard setting no tool here can read.
        */}
        <Text variant="body" color="textSecondary">
          We sent a link to {sentTo}.
          {musician?.email
            ? ` If one arrives at ${musician.email} too, follow both.`
            : ''}{' '}
          Your address stays as it is until you do.
        </Text>
        <SecondaryButton
          label="Done"
          onPress={goBack}
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
          title="Change email"
          onBack={goBack}
          backLabel="Back to profile"
        />

        <View>
          <Input
            label="New email"
            value={email}
            onChangeText={setEmail}
            // The address being replaced, where the header's "Currently …"
            // line used to say it: the thing this field replaces.
            placeholder={musician?.email ?? 'you@example.com'}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            editable={!busy}
          />

          {error ? (
            <Text accessibilityRole="alert"
              variant="metadataSmall"
              color="textSecondary"
              style={styles.error}
            >
              {error}
            </Text>
          ) : null}

          <PrimaryButton
            label="Send confirmation"
            onPress={() => void submit()}
            loading={busy}
            style={styles.submit}
          />
        </View>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
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
});
