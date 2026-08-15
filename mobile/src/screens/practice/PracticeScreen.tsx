import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';

import {
  PageHeader,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { usePiece } from '../../data/hooks/usePieces';
import { spacing } from '../../design';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';

/**
 * Placeholder destination for "Continue practice".
 *
 * The real screen is Phase 5 and depends on backend work that hasn't started:
 * recording needs `/v1/analyses` (Batch 4) and the audio analysis core
 * (Batch 3). It exists now so the Today screen's primary action leads
 * somewhere real rather than to a dead button.
 */
export function PracticeScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Practice'>>();
  const { data: piece } = usePiece(params.pieceId);

  return (
    <ScreenContainer>
      <PageHeader
        eyebrow={piece?.composer ?? undefined}
        title={piece?.title ?? 'Practice'}
      />

      <View style={styles.body}>
        <Text variant="body" color="textSecondary">
          Recording and tempo analysis land in Phase 5. The backend pipeline
          they depend on isn&apos;t built yet either.
        </Text>

        <SecondaryButton
          label="Back"
          onPress={() => navigation.goBack()}
          style={styles.action}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: {
    marginTop: spacing.lg,
  },
  action: {
    marginTop: spacing['2xl'],
  },
});
