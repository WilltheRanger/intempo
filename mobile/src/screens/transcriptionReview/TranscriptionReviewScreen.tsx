import { useNavigation } from '@react-navigation/native';
import { FileMusic } from 'lucide-react-native';
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
 * Placeholder for the transcription review, which is the next stage: source
 * score preview beside rendered notation, title and composer, page and measure
 * navigation, playback controls, and Save piece.
 */
export function TranscriptionReviewScreen() {
  const navigation = useNavigation<RootNavigation>();
  const pages = useCapturedPages();
  const label = pages.length === 1 ? '1 page' : `${pages.length} pages`;

  return (
    <ScreenContainer>
      <PageHeader eyebrow={label} title="Transcription" />

      <EmptyState
        icon={FileMusic}
        title="Not built yet"
        description="The transcription review — rendered notation, page and measure navigation, playback, and Save piece — arrives in the next stage."
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
