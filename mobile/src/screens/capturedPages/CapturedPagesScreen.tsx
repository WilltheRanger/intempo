import { useNavigation } from '@react-navigation/native';
import { Camera, Images, Layers, Plus } from '../../components/icons';
import { useGoBack } from '../../navigation/useGoBack';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { BottomSheet } from '../../components/overlays/BottomSheet';
import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import { SheetOptionRow } from '../../components/overlays/SheetOptionRow';
import {
  EmptyState,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import {
  captureSession,
  MAX_SCAN_PAGES,
  useCapturedPages,
} from '../../data/captureSession';
import { spacing } from '../../design';
import type { RootNavigation } from '../../navigation/types';
import { DraggablePageList } from './DraggablePageList';
import { PagePreview } from './PagePreview';
import { pageCountLabel } from '../../lib/format';
import { queueSummary } from '../../lib/scan/pageQueue';

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
  const goBack = useGoBack({ tab: 'Library' });
  const pages = useCapturedPages();
  // A captured page can't be recovered — the photo is gone with it — and the
  // bin sits a thumb's width from the drag handle.
  const [addSheet, setAddSheet] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  // Remembered when the dialog opens rather than derived from `pendingDelete`,
  // and deliberately *not* cleared with it. `ConfirmDialog` is a fading modal
  // that keeps rendering its title through the dismiss animation, so a derived
  // title fell to `findIndex` returning -1 the instant the id went null — and
  // the last thing anyone read, every time they confirmed or cancelled a
  // deletion, was "Delete page 0?" on its way out.
  const [pendingPosition, setPendingPosition] = useState(1);
  // Which page is open at full size, by index — not by object, so a reorder or
  // a retake underneath does not leave the preview holding a stale copy.
  const [openPage, setOpenPage] = useState<number | null>(null);

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
  const atPageLimit = pages.length >= MAX_SCAN_PAGES;

  const scannerBelow =
    navigation.getState()?.routes.some((route) => route.name === 'Scanner') ?? false;

  /**
   * **"Add page" used to mean the viewfinder, and only the viewfinder.**
   *
   * Reported as *"why can't I upload the 2nd page as an image?"* — and the
   * answer was that this function navigated to `Scanner` with no other route
   * out. The library was reachable only from the action that *began* a scan,
   * because `importAll` resets, so coming back to add page two from the photo
   * roll threw page one away. A photograph already on the phone could join a
   * scan in the first action or not at all.
   *
   * Both are offered now. `adding` is what stops either of them resetting the
   * scan they were opened to extend — the caller decides, because from inside
   * `captureSession` an abandoned scan and one being added to are the same
   * array.
   */
  function addFromCamera() {
    setAddSheet(false);
    if (scannerBelow) {
      goBack();
      return;
    }
    navigation.navigate('Scanner', { adding: true });
  }

  function addFromLibrary() {
    setAddSheet(false);
    navigation.navigate('AddPiece', { option: 'import', adding: true });
  }

  function addPage() {
    if (atPageLimit) {
      return;
    }
    setAddSheet(true);
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
    const everHeld = captureSession.hasHeldPages();
    return (
      <ScreenContainer>
        <PageHeader
          title="Review pages"
          onBack={goBack}
          backLabel={scannerBelow ? 'Back to the scanner' : 'Back'}
        />
        {/*
          **Two empty states, because empty means two things.** A scan whose
          pages were all removed, and one that never had any — which is what a
          refresh or a link straight to `/scan/pages` produces, and which the
          routing allows on purpose so a refresh lands on the step you were on.
          They are the same empty array, so the session is asked
          (`hasHeldPages`); telling someone they removed pages they never took
          is a small lie about their own actions.
        */}
        <EmptyState
          icon={Layers}
          title={everHeld ? 'No pages left' : 'No pages yet'}
          description={
            everHeld
              ? "You've removed every page. Capture at least one to continue."
              : 'Photograph a page of sheet music to start a scan.'
          }
          actionLabel={everHeld ? 'Add page' : 'Photograph a page'}
          onActionPress={addPage}
        />

      <BottomSheet
        visible={addSheet}
        onClose={() => setAddSheet(false)}
        title="Add page"
      >
        {/*
          Named by what the musician has in their hand, the way `AddPieceSheet`
          names its four — not by what the app does with it.
        */}
        <SheetOptionRow
          icon={Camera}
          label="Photograph a page"
          description="Use the camera on the page in front of you."
          onPress={addFromCamera}
          divided={false}
        />
        <SheetOptionRow
          icon={Images}
          label="Choose photos"
          description="Pictures of the music already on this device."
          onPress={addFromLibrary}
        />
      </BottomSheet>
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
          label={pages.length === 1 ? "Continue with 1 page" : `Continue with ${pages.length} pages`}
          onPress={() => navigation.navigate('Transcribe')}
        />
      }
    >
      <PageHeader
        eyebrow={pageCountLabel(pages.length)}
        title="Review pages"
        onBack={goBack}
        // It said "Back to the scanner" on a route with no scanner on it.
        backLabel={scannerBelow ? 'Back to the scanner' : 'Back'}
      />

      {/*
        The order, and the caveat when there is one. Both live in
        `pageQueue.ts` — a rule in a `.tsx` is a rule nothing checks, and
        "does this warn when it should" is the kind that stays wrong quietly.
      */}
      <Text variant="metadataSmall" color="textTertiary" style={styles.hint}>
        {queueSummary(pages)}
      </Text>

      <DraggablePageList
        pages={pages}
        onReorder={(id, toIndex) => captureSession.moveTo(id, toIndex)}
        onOpen={(_page, index) => setOpenPage(index)}
        onRetake={(page) => handleRetake(page.id)}
        onDelete={askToDelete}
        onNudge={(id, direction) => captureSession.move(id, direction)}
      />

      {atPageLimit ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.addPage}>
          A scan can contain up to {MAX_SCAN_PAGES} pages.
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

      <BottomSheet
        visible={addSheet}
        onClose={() => setAddSheet(false)}
        title="Add page"
      >
        {/*
          Named by what the musician has in their hand, the way `AddPieceSheet`
          names its four — not by what the app does with it.
        */}
        <SheetOptionRow
          icon={Camera}
          label="Photograph a page"
          description="Use the camera on the page in front of you."
          onPress={addFromCamera}
          divided={false}
        />
        <SheetOptionRow
          icon={Images}
          label="Choose photos"
          description="Pictures of the music already on this device."
          onPress={addFromLibrary}
        />
      </BottomSheet>

      {/*
        Held by index and read back out of `pages`, so deleting or reordering
        underneath cannot strand the preview on a page that has moved. An index
        past the end reads as null, which closes it.
      */}
      <PagePreview
        page={openPage === null ? null : (pages[openPage] ?? null)}
        position={(openPage ?? 0) + 1}
        total={pages.length}
        onClose={() => setOpenPage(null)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hint: {
    marginBottom: spacing.md,
  },
  addPage: {
    marginTop: spacing.xl,
  },
});
