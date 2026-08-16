import { useNavigation } from '@react-navigation/native';
import { Layers, Plus } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

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
    // A scan can be four pages or thirty, so Continue is pinned rather than
    // parked under the last row. Add page stays with the list: it belongs to
    // the pages, and it's the one action that shouldn't be easier to hit than
    // scrolling through what you've already captured.
    <ScreenContainer
      footer={
        <PrimaryButton
          label="Continue"
          onPress={() => navigation.navigate('Transcribe')}
        />
      }
    >
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

      <SecondaryButton
        label="Add page"
        icon={Plus}
        onPress={() => navigation.goBack()}
        style={styles.addPage}
      />
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
  addPage: {
    marginTop: spacing.xl,
  },
});
