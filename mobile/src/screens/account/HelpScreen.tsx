import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGoBack } from '../../navigation/useGoBack';

import appConfig from '../../../app.json';
import {
  Card,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { IS_LIVE_BACKEND } from '../../data/environment';
import { checkLiveAppConnection } from '../../data/liveSupportDiagnostics';
import {
  type ConnectionReport,
} from '../../data/supportDiagnostics';
import { BORDER_WIDTH, colors, spacing } from '../../design';

interface Copy {
  title: string;
  detail: string;
}

function copyFor(report: ConnectionReport | null, checking: boolean): Copy {
  if (checking) {
    return {
      title: 'Checking the connection',
      detail: 'Checking the server and your account.',
    };
  }
  if (!IS_LIVE_BACKEND) {
    return {
      title: 'Sample mode',
      detail: 'Sample data. Not connected.',
    };
  }
  if (!report) {
    return {
      title: 'Not checked yet',
      detail: 'Check the server and your account.',
    };
  }
  if (report.kind === 'connected') {
    return {
      title: 'Everything is connected',
      detail: 'Server and account are working.',
    };
  }
  if (report.kind === 'session_ended') {
    return {
      title: 'Your sign-in has expired',
      detail: 'Sign in again to reconnect.',
    };
  }
  if (report.kind === 'service_unreachable') {
    return {
      title: 'Couldn’t reach the server',
      detail: `${report.message} Wait a moment and check again.`,
    };
  }
  if (report.kind === 'service_unready') {
    return {
      title: 'InTempo needs a service update',
      detail: `${report.message} This is an InTempo setup problem, not your connection or account. Recording, score reading, or saving may not work until it is fixed.`,
    };
  }
  return {
    title: 'The service is awake, but your account did not open',
    detail: `${report.message} Check again before signing out; a temporary connection can clear on its own.`,
  };
}

/**
 * A self-service answer to “is the app down, or is it my connection?”
 *
 * The check is deliberately read-only. It wakes the public health endpoint,
 * then reads the signed-in account. The guidance below covers the setup facts
 * that materially change recording and transcription quality.
 */
export function HelpScreen() {
  const goBack = useGoBack({ tab: 'Profile' });
  const [report, setReport] = useState<ConnectionReport | null>(null);
  const [checking, setChecking] = useState(false);

  const runCheck = useCallback(async () => {
    if (!IS_LIVE_BACKEND || checking) {
      return;
    }
    setChecking(true);
    try {
      setReport(await checkLiveAppConnection());
    } finally {
      setChecking(false);
    }
  }, [checking]);

  useEffect(() => {
    void runCheck();
    // Run once on entry. The button handles deliberate repeats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = copyFor(report, checking);

  return (
    <ScreenContainer>
      <PageHeader
        eyebrow={`Version ${appConfig.expo.version}`}
        title="Help & connection"
        onBack={goBack}
        backLabel="Back to profile"
      />

      <Card>
        <Text variant="pieceTitle">{status.title}</Text>
        <Text variant="body" color="textSecondary" style={styles.detail}>
          {status.detail}
        </Text>
        <PrimaryButton
          label={checking ? 'Checking…' : 'Check again'}
          onPress={() => void runCheck()}
          loading={checking}
          disabled={!IS_LIVE_BACKEND}
          style={styles.action}
        />
      </Card>

      <SectionHeader label="Recording setup" style={styles.section} />
      <Card padded={false}>
        <View style={styles.rows}>
          <Tip
            first
            title="Place the phone nearby"
            detail="Mic uncovered, away from anything that rattles."
          />
          <Tip
            title="Use headphones for the click"
            detail="A click through the speaker gets recorded. The count-in is cut before sending."
          />
          <Tip
            title="Count-in and long rests"
            detail="Every take starts with a one-bar count-in. Long rests count down to your entry."
          />
        </View>
      </Card>

      <SectionHeader label="Scanning setup" style={styles.section} />
      <Card padded={false}>
        <View style={styles.rows}>
          <Tip
            title="Fill the frame"
            detail="Even light, page flat, every staff in view."
            first
          />
          <Tip
            title="Fix flagged bars"
            detail="Fix them before trusting a verdict."
          />
        </View>
      </Card>
    </ScreenContainer>
  );
}

function Tip({
  title,
  detail,
  first = false,
}: {
  title: string;
  detail: string;
  first?: boolean;
}) {
  return (
    <View style={[styles.tip, !first && styles.divided]}>
      <Text variant="button">{title}</Text>
      <Text variant="metadataSmall" color="textSecondary" style={styles.tipDetail}>
        {detail}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  detail: {
    marginTop: spacing.sm,
  },
  action: {
    marginTop: spacing.xl,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  rows: {
    paddingHorizontal: spacing.lg,
  },
  tip: {
    paddingVertical: spacing.lg,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  tipDetail: {
    marginTop: spacing.xs,
  },
});
