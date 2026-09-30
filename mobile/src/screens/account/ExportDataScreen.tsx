import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useGoBack } from '../../navigation/useGoBack';

import {
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import {
  fetchAccountExport,
  saveAccountExport,
} from '../../data/accountExport';
import { spacing } from '../../design';

export function ExportDataScreen() {
  const goBack = useGoBack({ tab: 'Profile' });
  const [preparing, setPreparing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setPreparing(true);
    setDone(false);
    setError(null);
    try {
      const data = await fetchAccountExport();
      // Only when it actually left the app. `saveAccountExport` answers false
      // for a share sheet the musician dismissed, which used to resolve like a
      // success and put "Your export is ready" under a download that never
      // happened.
      setDone(await saveAccountExport(data));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your data could not be prepared. Try again.',
      );
    } finally {
      setPreparing(false);
    }
  }

  return (
    <ScreenContainer>
      <PageHeader
        title="Download your data"
        onBack={goBack}
        backLabel="Back to profile"
      />

      {/* Two lines where there was a line, a boxed list and a footnote (the
          owner's sweep, 2026-09-29). */}
      <Text variant="body" color="textSecondary" style={styles.lede}>
        A copy of your data.
      </Text>

      <Text variant="metadataSmall" color="textTertiary" style={styles.note}>
        Photos and audio aren’t included.
      </Text>

      <PrimaryButton
        label={done ? 'Download another copy' : 'Prepare download'}
        onPress={() => void prepare()}
        loading={preparing}
        style={styles.action}
      />

      {done ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.status}>
          Your export is ready. Keep it somewhere private.
        </Text>
      ) : null}

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.status}>
          {error}
        </Text>
      ) : null}
    </ScreenContainer>
  );
}


const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.md,
  },
  note: {
    marginTop: spacing.lg,
  },
  action: {
    marginTop: spacing['2xl'],
  },
  status: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
