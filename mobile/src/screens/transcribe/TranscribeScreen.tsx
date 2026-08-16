import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  EmptyState,
  MetadataRow,
  PrimaryButton,
  ProgressBar,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { useCapturedPages } from '../../data/captureSession';
import { spacing } from '../../design';
import type { RootNavigation } from '../../navigation/types';

/**
 * How long each page appears to take. Mock only — there is no transcription
 * pipeline behind this, and nothing here measures real work.
 */
const MOCK_MS_PER_PAGE = 900;

/**
 * Mocked transcription processing.
 *
 * Progress is reported per page rather than as a percentage: the page count is
 * something we genuinely know, whereas "73%" would be invented precision about
 * work that isn't happening. When the real pipeline lands it can report the
 * page it's on and this screen is unchanged.
 */
export function TranscribeScreen() {
  const navigation = useNavigation<RootNavigation>();
  const pages = useCapturedPages();
  const total = pages.length;
  const [completed, setCompleted] = useState(0);
  const isComplete = total > 0 && completed >= total;

  useEffect(() => {
    if (total === 0 || completed >= total) {
      return;
    }
    const timer = setTimeout(
      () => setCompleted((done) => done + 1),
      MOCK_MS_PER_PAGE,
    );
    return () => clearTimeout(timer);
  }, [completed, total]);

  if (total === 0) {
    return (
      <ScreenContainer>
        <EmptyState
          title="Nothing to transcribe"
          description="Capture at least one page first."
          actionLabel="Back"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scrollable={false} contentStyle={styles.centered}>
      <View>
        <Text variant="heroTitle">
          {isComplete ? 'Transcription ready' : 'Transcribing your score'}
        </Text>

        <Text variant="body" color="textSecondary" style={styles.subtitle}>
          {isComplete
            ? 'Check the notation before you save this piece.'
            : 'Reading notation and preparing playback…'}
        </Text>

        {/*
          Tracks the page being read, matching the label beneath it — an empty
          track while the screen says "Page 1 of 3" reads as nothing happening.
        */}
        <ProgressBar
          value={isComplete ? 1 : Math.min(completed + 1, total) / total}
          accessibilityLabel="Transcription progress"
          style={styles.progress}
        />

        <MetadataRow
          variant="metadataSmall"
          items={[
            isComplete
              ? pageLabel(total)
              : `Page ${Math.min(completed + 1, total)} of ${total}`,
          ]}
          style={styles.meta}
        />
      </View>

      <View style={styles.actions}>
        {isComplete ? (
          <PrimaryButton
            label="Review transcription"
            onPress={() => navigation.navigate('TranscriptionReview')}
          />
        ) : (
          <SecondaryButton
            label="Cancel"
            onPress={() => navigation.goBack()}
          />
        )}
      </View>
    </ScreenContainer>
  );
}

function pageLabel(count: number): string {
  return count === 1 ? '1 page read' : `${count} pages read`;
}

const styles = StyleSheet.create({
  // A transient full-screen state; centring it stops the content clinging to
  // the top of an otherwise empty screen.
  centered: {
    justifyContent: 'center',
  },
  subtitle: {
    marginTop: spacing.md,
  },
  progress: {
    marginTop: spacing['3xl'],
  },
  meta: {
    marginTop: spacing.md,
  },
  actions: {
    marginTop: spacing['3xl'],
  },
});
