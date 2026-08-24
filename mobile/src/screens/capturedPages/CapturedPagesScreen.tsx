import { useNavigation } from '@react-navigation/native';
import { Layers, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
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
  // A captured page can't be recovered — the photo is gone with it — and the
  // bin sits a thumb's width from the drag handle.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const pendingPosition = pages.findIndex((page) => page.id === pendingDelete) + 1;

  function handleRetake(id: string) {
    // **Nothing is deleted here.** The page is marked as the one the next
    // photograph replaces, and `captureSession.capture` swaps it in where it
    // already sits. Both halves of that are fixes:
    //
    // It used to `remove` first, so closing the viewfinder — or a shutter that
    // returned no image — left the page gone with nothing in its place, no
    // confirmation and no undo, on a screen whose delete button asks first.
    //
    // And the replacement used to be *appended*, because the shutter called
    // `add`. Retaking page 1 of a four-page scan put the new page 1 at
    // position 4 and promoted page 2 into its place — and since the upload
    // sends `pages[0]`, the app then transcribed page 2 while the page just
    // re-shot was never sent at all.
    //
    // `navigate` rather than `goBack`: on the scanner route the viewfinder is
    // below this screen and navigating pops back to it, unmounted-effect and
    // all. Pages that arrived through Import have no scanner below them, and
    // `goBack` there dropped the musician onto the Today tab with the scan
    // unreachable.
    captureSession.beginRetake(id);
    navigation.navigate('Scanner');
  }

  if (pages.length === 0) {
    return (
      <ScreenContainer>
        <PageHeader
          title="Review pages"
          onBack={() => navigation.goBack()}
          backLabel="Back to the scanner"
        />
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
      <PageHeader
        eyebrow={pageCountLabel(pages.length)}
        title="Review pages"
        onBack={() => navigation.goBack()}
        backLabel="Back to the scanner"
      />

      <Text variant="metadataSmall" color="textTertiary" style={styles.hint}>
        Drag to reorder — pages transcribe in this order.
      </Text>

      <DraggablePageList
        pages={pages}
        onReorder={(id, toIndex) => captureSession.moveTo(id, toIndex)}
        onRetake={(page) => handleRetake(page.id)}
        onDelete={(id) => setPendingDelete(id)}
        onNudge={(id, direction) => captureSession.move(id, direction)}
      />

      <SecondaryButton
        label="Add page"
        icon={Plus}
        onPress={() => navigation.goBack()}
        style={styles.addPage}
      />

      <ConfirmDialog
        visible={pendingDelete !== null}
        title={`Delete page ${pendingPosition}?`}
        message="The photo goes with it. You'd have to shoot the page again."
        confirmLabel="Delete"
        onConfirm={() => {
          if (pendingDelete) {
            captureSession.remove(pendingDelete);
          }
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
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
