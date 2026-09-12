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
import { apiFetch } from '../../data/api/client';
import { IS_LIVE_BACKEND } from '../../data/environment';
import {
  checkAppConnection,
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
      detail: 'Waking the practice service and checking your account.',
    };
  }
  if (!IS_LIVE_BACKEND) {
    return {
      title: 'Sample mode',
      detail: 'This build is using sample data and is not connected to an account service.',
    };
  }
  if (!report) {
    return {
      title: 'Not checked yet',
      detail: 'Run a check to test both the practice service and your signed-in account.',
    };
  }
  if (report.kind === 'connected') {
    return {
      title: 'Everything is connected',
      detail: 'InTempo reached the practice service and opened your account.',
    };
  }
  if (report.kind === 'session_ended') {
    return {
      title: 'Your sign-in has expired',
      detail: 'InTempo will return you to sign in so your account can reconnect safely.',
    };
  }
  if (report.kind === 'service_unreachable') {
    return {
      title: 'The practice service could not be reached',
      detail: `${report.message} If the app has been idle, wait a moment and check again.`,
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
      setReport(
        await checkAppConnection((path, options) => apiFetch(path, options)),
      );
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
            detail="Keep the microphone uncovered and away from a music stand that can rattle. For double bass, clear bowed or plucked attacks are easier to follow than a distant room recording."
          />
          <Tip
            title="Use headphones for an audible click"
            detail="During the take, a metronome over the speaker enters the recording and can be mistaken for your attacks; visual and haptic modes do not. The count-in is the exception — it always ticks out loud, and those seconds are discarded before the take is sent."
          />
          <Tip
            title="Count-in and long rests"
            detail="Every take starts with one full bar, counted out loud and in your hand whatever the metronome is set to. During a long rest, InTempo shows the measure you return in and counts the final pulses to your entrance."
          />
        </View>
      </Card>

      <SectionHeader label="Scanning setup" style={styles.section} />
      <Card padded={false}>
        <View style={styles.rows}>
          <Tip
            title="Fill the frame with the page"
            detail="Use even light, keep the page flat, and include every staff edge. Review and reorder multi-page scans before sending them."
            first
          />
          <Tip
            title="Check uncertain measures"
            detail="InTempo names bars whose timing or notation could not be verified. Correct those bars before relying on a practice verdict."
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
