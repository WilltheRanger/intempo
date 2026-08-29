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
import { MAX_PAGES } from '../../lib/scan/uploadPages';
import { spacing } from '../../design';
import type { RootNavigation } from '../../navigation/types';
import { DraggablePageList } from './DraggablePageList';

/**
 * The pages just captured, in the order they will be read.
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
  // Remembered when the dialog opens rather than derived from `pendingDelete`,
  // and deliberately *not* cleared with it. `ConfirmDialog` is a fading modal
  // that keeps rendering its title through the dismiss animation, so a derived
  // title fell to `findIndex` returning -1 the instant the id went null — and
  // the last thing anyone read, every time they confirmed or cancelled a
  // deletion, was "Delete page 0?" on its way out.
  const [pendingPosition, setPendingPosition] = useState(1);

  function askToDelete(id: string) {
    setPendingPosition(pages.findIndex((page) => page.id === id) + 1);
    setPendingDelete(id);
  }

  // Whether the viewfinder is underneath us.
  //
  // It is on the scan route and it is not on the import route, where
  // `ImportPages` *replaces* itself with this screen. Four controls here need
  // to know: three of them called `goBack()` regardless, which on the import
  // route meant the Today tab — with the pages still in the session and
  // nothing able to reach them, since the only screens that navigate here both
  // start a new one.
  const scannerBelow =
    navigation.getState()?.routes.some((route) => route.name === 'Scanner') ?? false;

  // "Add page" means the viewfinder either way. `adding` is what stops a
  // freshly pushed one resetting the scan it was opened to extend.
  function addPage() {
    if (scannerBelow) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Scanner', { adding: true });
  }

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
          title="Your pages"
          onBack={() => navigation.goBack()}
          backLabel={scannerBelow ? 'Back to the scanner' : 'Back'}
        />
        <EmptyState
          icon={Layers}
          title="No pages left"
          description="You've removed every page. Photograph at least one to carry on."
          actionLabel="Add page"
          onActionPress={addPage}
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
          onPress={() => navigation.navigate('TranscriptionReview')}
        />
      }
    >
      <PageHeader
        eyebrow={pageCountLabel(pages.length)}
        title="Your pages"
        onBack={() => navigation.goBack()}
        // It said "Back to the scanner" on a route with no scanner on it.
        backLabel={scannerBelow ? 'Back to the scanner' : 'Back'}
      />

      <Text variant="metadataSmall" color="textTertiary" style={styles.hint}>
        Drag to reorder. Every page is read, in this order.
      </Text>

      <DraggablePageList
        pages={pages}
        onReorder={(id, toIndex) => captureSession.moveTo(id, toIndex)}
        onRetake={(page) => handleRetake(page.id)}
        onDelete={askToDelete}
        onNudge={(id, direction) => captureSession.move(id, direction)}
      />

      {pages.length >= MAX_PAGES ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.addPage}>
          {`That is ${MAX_PAGES} pages, as long as one scan can be. Save these, then start another piece for the rest.`}
        </Text>
      ) : (
        <SecondaryButton
          label="Add page"
          icon={Plus}
          onPress={addPage}
          style={styles.addPage}
        />
      )}

      <ConfirmDialog
        visible={pendingDelete !== null}
        title={`Delete page ${pendingPosition}?`}
        message="The photograph goes with it. You'd have to take it again."
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
