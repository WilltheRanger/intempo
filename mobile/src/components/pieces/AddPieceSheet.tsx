import { useEffect, useState } from 'react';

import { Camera, FileMusic, Images, PencilLine } from '../icons';

import { captureSession } from '../../data/captureSession';
import { BottomSheet } from '../overlays/BottomSheet';
import { SheetOptionRow } from '../overlays/SheetOptionRow';
import { InlineCameraCapture } from './InlineCameraCapture';
import type { AddPieceOption } from '../../navigation/types';

export interface AddPieceSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Every way in *except* the camera: the picture library, a MusicXML file, or
   * typing the piece by hand. Those still leave the sheet for their own screen.
   */
  onSelect: (option: Exclude<AddPieceOption, 'scan'>) => void;
  /**
   * A page has been photographed and put in the session. The sheet closes
   * itself first — see `BottomSheet`'s own note on why the wait matters —
   * so this is where the caller navigates on to `CapturedPages`.
   */
  onCaptured: () => void;
}

const SCAN_OPTION = {
  icon: Camera,
  label: 'Photograph sheet music',
  description: 'Use the camera on the pages in front of you.',
};

const OPTIONS = [
  {
    option: 'import' as const,
    icon: Images,
    label: 'Choose photos',
    description: 'Pictures of the music already on this device.',
  },
  {
    option: 'notation' as const,
    icon: FileMusic,
    label: 'Open a MusicXML file',
    description: 'Exported from MuseScore, Sibelius or Finale.',
  },
  {
    option: 'manual' as const,
    icon: PencilLine,
    label: 'Enter it by hand',
    description: 'Type the details in. Nothing is read from a page.',
  },
];

/**
 * The four ways a piece enters the library, named by what you have in your
 * hand rather than by what the app does with it.
 *
 * "Import score" described the second option by the verb and promised a PDF
 * the screen behind it never accepted — `launchImageLibraryAsync` is called
 * with `mediaTypes: ['images']`. "Add manually" and "Scan" named the app's
 * actions; a musician has paper, or files, or neither.
 *
 * Shared rather than the Library's own, because Today needs it too: a new
 * account lands on Today with nothing, and until this moved, the screen told
 * them to photograph sheet music and offered nothing to press.
 *
 * **The camera is the one option that doesn't leave.** Every other choice
 * hands off to its own screen; the camera preview now opens in place, inside
 * this same sheet, the way a photograph is taken elsewhere in the app that
 * inspired it. See `InlineCameraCapture` for why that's one page and not a
 * whole scan.
 */
export function AddPieceSheet({
  visible,
  onClose,
  onSelect,
  onCaptured,
}: AddPieceSheetProps) {
  const [mode, setMode] = useState<'menu' | 'camera'>('menu');

  // Closed sheets reopen on the menu, not wherever they were left. Keyed off
  // `visible` rather than `onClose`, which fires on the same dismissal this
  // is meant to follow, not on the next opening.
  useEffect(() => {
    if (!visible) {
      setMode('menu');
    }
  }, [visible]);

  function openCamera() {
    // A fresh "add piece" scan, same as opening the full scanner does —
    // there is no piece yet and nothing here is a retake.
    captureSession.reset();
    setMode('camera');
  }

  function handleCapture(uri: string) {
    captureSession.capture(uri);
    onCaptured();
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={mode === 'menu' ? 'Add piece' : undefined}
      expand={mode === 'camera'}
      hideCloseButton={mode === 'camera'}
      dragWholeBody={mode === 'camera'}
    >
      {mode === 'camera' ? (
        <InlineCameraCapture
          onCapture={handleCapture}
          onCancel={() => setMode('menu')}
          onChooseImages={() => onSelect('import')}
        />
      ) : (
        <>
          <SheetOptionRow
            icon={SCAN_OPTION.icon}
            label={SCAN_OPTION.label}
            description={SCAN_OPTION.description}
            divided={false}
            onPress={openCamera}
          />
          {OPTIONS.map((entry) => (
            <SheetOptionRow
              key={entry.option}
              icon={entry.icon}
              label={entry.label}
              description={entry.description}
              onPress={() => onSelect(entry.option)}
            />
          ))}
        </>
      )}
    </BottomSheet>
  );
}
