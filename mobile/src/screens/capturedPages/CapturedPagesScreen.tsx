import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Layers } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import {
  EmptyState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
} from '../../components/primitives';
import { spacing } from '../../design';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';

/**
 * Placeholder for the captured-pages review, which is the next stage:
 * reorder, delete, retake, add page, continue.
 */
export function CapturedPagesScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'CapturedPages'>>();
  const label = params.pageCount === 1 ? '1 page' : `${params.pageCount} pages`;

  return (
    <ScreenContainer>
      <PageHeader eyebrow={label} title="Review pages" />

      <EmptyState
        icon={Layers}
        title="Not built yet"
        description="Reordering, deleting, retaking, and adding pages arrive in the next stage, before transcription."
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
