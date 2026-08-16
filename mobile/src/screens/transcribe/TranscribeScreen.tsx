import { useNavigation } from '@react-navigation/native';
import { AudioLines } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import {
  EmptyState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
} from '../../components/primitives';
import { useCapturedPages } from '../../data/captureSession';
import { spacing } from '../../design';
import type { RootNavigation } from '../../navigation/types';

/**
 * Placeholder for the mocked transcription processing state, which is the
 * next stage: "Transcribing your score / Reading notation and preparing
 * playback…", then on to the transcription review.
 */
export function TranscribeScreen() {
  const navigation = useNavigation<RootNavigation>();
  const pages = useCapturedPages();
  const label = pages.length === 1 ? '1 page' : `${pages.length} pages`;

  return (
    <ScreenContainer>
      <PageHeader eyebrow={label} title="Transcribe" />

      <EmptyState
        icon={AudioLines}
        title="Not built yet"
        description="The processing state and the transcription review arrive in the next stage. No transcription runs — there is no pipeline behind this yet."
      />

      <View style={styles.actions}>
        <SecondaryButton label="Back" onPress={() => navigation.goBack()} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  actions: {
    marginTop: spacing.xl,
  },
});
