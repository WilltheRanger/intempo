import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Images, PencilLine, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import {
  EmptyState,
  PageHeader,
  ScreenContainer,
  SecondaryButton,
} from '../../components/primitives';
import { spacing } from '../../design';
import type {
  AddPieceOption,
  RootNavigation,
  RootStackParamList,
} from '../../navigation/types';

interface OptionCopy {
  title: string;
  icon: LucideIcon;
  description: string;
}

/** Scan has a real screen now; only these two are still placeholders. */
const COPY: Record<Exclude<AddPieceOption, 'scan'>, OptionCopy> = {
  import: {
    title: 'Import score',
    icon: Images,
    description:
      'Picking existing images or a PDF comes after the scanner, and reuses the same page-review step.',
  },
  manual: {
    title: 'Add manually',
    icon: PencilLine,
    description:
      'Creating a piece without transcription — title, composer, movement — lands with the piece detail screen.',
  },
};

/**
 * Placeholder destination for each Add Piece option.
 *
 * Exists so the sheet leads somewhere real while the flows behind it are
 * built in order. Each one is replaced by its actual screen in a later stage.
 */
export function AddPieceScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'AddPiece'>>();
  const copy = COPY[params.option];

  return (
    <ScreenContainer>
      <PageHeader title={copy.title} />

      <EmptyState
        icon={copy.icon}
        title="Not built yet"
        description={copy.description}
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
