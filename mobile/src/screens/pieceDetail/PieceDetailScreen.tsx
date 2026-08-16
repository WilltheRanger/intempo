import { useNavigation } from '@react-navigation/native';
import { Music } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import {
  EmptyState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
} from '../../components/primitives';
import { spacing } from '../../design';
import type { RootNavigation } from '../../navigation/types';

/**
 * Placeholder for the saved-piece detail screen, which is the next stage:
 * score preview, practice progress, Continue practice, playback, and access to
 * both the digital score and the original scanned pages.
 */
export function PieceDetailScreen() {
  const navigation = useNavigation<RootNavigation>();

  return (
    <ScreenContainer>
      <PageHeader title="Piece" />

      <EmptyState
        icon={Music}
        title="Not built yet"
        description="The saved-piece screen arrives in the next stage. Nothing is written anywhere — saving isn't wired to storage."
      />

      <View style={styles.actions}>
        <SecondaryButton
          label="Back to library"
          onPress={() => navigation.navigate('Tabs')}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  actions: {
    marginTop: spacing.xl,
  },
});
