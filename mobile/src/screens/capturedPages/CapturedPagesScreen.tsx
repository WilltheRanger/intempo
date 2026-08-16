import { useNavigation } from '@react-navigation/native';
import { Layers, Plus } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import {
  EmptyState,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { captureSession, useCapturedPages } from '../../data/captureSession';
import { spacing } from '../../design';
import type { RootNavigation } from '../../navigation/types';
import { MOCK_CAPTURES } from '../scanner/ScannerScreen';
import { DraggablePageList } from './DraggablePageList';

/**
 * Review of the pages just captured, before transcription.
 *
 * Reorder, retake, and delete all act on the shared capture session, so going
 * back to add another page keeps whatever order was set here.
 *
 * Reordering is by drag. Dragging is not an accessible gesture, so each row
 * also carries move-up and move-down accessibility actions.
 */
export function CapturedPagesScreen() {
  const navigation = useNavigation<RootNavigation>();
  const pages = useCapturedPages();

  function handleRetake(id: string, index: number) {
    // Stands in for re-shooting the page: swap in a different image so the
    // change is visible. Real retake reopens the camera for this page only.
    captureSession.replace(id, MOCK_CAPTURES[(index + 1) % MOCK_CAPTURES.length]);
  }

  if (pages.length === 0) {
    return (
      <ScreenContainer>
        <PageHeader title="Review pages" />
        <EmptyState
          icon={Layers}
          title="No pages left"
          description="You've removed every page. Capture at least one to continue."
          actionLabel="Add page"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <PageHeader eyebrow={pageCountLabel(pages.length)} title="Review pages" />

      <Text variant="metadataSmall" color="textTertiary" style={styles.hint}>
        Drag to reorder — pages transcribe in this order.
      </Text>

      <DraggablePageList
        pages={pages}
        onReorder={(id, toIndex) => captureSession.moveTo(id, toIndex)}
        onRetake={(page, index) => handleRetake(page.id, index)}
        onDelete={(id) => captureSession.remove(id)}
        onNudge={(id, direction) => captureSession.move(id, direction)}
      />

      <View style={styles.actions}>
        <SecondaryButton
          label="Add page"
          icon={Plus}
          onPress={() => navigation.goBack()}
        />
        <PrimaryButton
          label="Continue"
          onPress={() => navigation.navigate('Transcribe')}
          style={styles.continue}
        />
      </View>
    </ScreenContainer>
  );
}

function pageCountLabel(count: number): string {
  return count === 1 ? '1 page' : `${count} pages`;
}

const styles = StyleSheet.create({
  hint: {
    marginBottom: spacing.md,
  },
  actions: {
    marginTop: spacing['2xl'],
  },
  continue: {
    marginTop: spacing.md,
  },
});
