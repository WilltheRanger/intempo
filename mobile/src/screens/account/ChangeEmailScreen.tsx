import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useGoBack } from '../../navigation/useGoBack';

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
  const navigation = useNavigation();
  const goBack = useGoBack({ tab: 'Profile' });
  const { data: musician } = useMe();

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

  if (sentTo) {
    return (
      <ScreenContainer>
        <PageHeader
          title="Confirm the change"
          onBack={goBack}
          backLabel="Back to profile"
        />
        <Text variant="body" color="textSecondary">
          We sent a link to {sentTo}. Your address stays as it is until you
          follow it.
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
          eyebrow={musician ? `Currently ${musician.email}` : null}
          title="Change email"
          onBack={goBack}
          backLabel="Back to profile"
        />

        <View>
          <Input
            label="New email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            editable={!busy}
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
