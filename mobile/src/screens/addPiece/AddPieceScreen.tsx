import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Images } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import {
  EmptyState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
} from '../../components/primitives';
import { spacing } from '../../design';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { ManualPieceForm } from './ManualPieceForm';

/**
 * Where the two non-camera Add Piece options land.
 *
 * "Add manually" is a real screen. "Import score" is not yet, and this says so
 * rather than pretending: picking images out of the photo library needs a
 * picker this app doesn't yet depend on, and everything after the picker —
 * page review, OCR, save — is the scanner's flow, which already exists. So the
 * work is a front end onto a built pipeline, not a new one.
 */
export function AddPieceScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'AddPiece'>>();

  if (params.option === 'manual') {
    return <ManualPieceForm />;
  }

  return (
    <ScreenContainer>
      <PageHeader title="Import score" />

      <EmptyState
        icon={Images}
        title="Not built yet"
        description="Choosing images or a PDF from your device is still to come. Scanning the pages with the camera works today, and lands in the same review step."
        actionLabel="Scan instead"
        onActionPress={() => navigation.replace('Scanner')}
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
