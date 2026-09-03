import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGoBack } from '../../navigation/useGoBack';

import {
  Card,
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
import type { RootNavigation } from '../../navigation/types';

export function ExportDataScreen() {
  const navigation = useNavigation<RootNavigation>();
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

      <Text variant="body" color="textSecondary" style={styles.lede}>
        Get a portable JSON copy of the information InTempo keeps about your
        account.
      </Text>

      <Card emphasis style={styles.card}>
        <Text variant="button">Included</Text>
        <View style={styles.list}>
          <Bullet>profile and account settings</Bullet>
          <Bullet>pieces and the score data read from them</Bullet>
          <Bullet>practice results, timing feedback, and corrections</Bullet>
          <Bullet>assignments, studio records, and sync history</Bullet>
        </View>
      </Card>

      <Text variant="metadataSmall" color="textTertiary" style={styles.note}>
        Uploaded photos and audio are counted in the export but are not embedded
        in the JSON file. No storage access tokens are included.
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
