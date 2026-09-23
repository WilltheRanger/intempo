import { Camera, FileMusic, Images, PencilLine } from '../icons';

import { BottomSheet } from '../overlays/BottomSheet';
import { SheetOptionRow } from '../overlays/SheetOptionRow';
import type { AddPieceOption } from '../../navigation/types';
import { rowDivided } from '../rowMetrics';

export interface AddPieceSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (option: AddPieceOption) => void;
}

/**
 * **Four labels, and no line under any of them.**
 *
 * Each one carried a description and each description said the label again:
 * "Photograph sheet music / Use the camera on the pages in front of you",
 * "Choose photos / Pictures of the music already on this device", "Enter it by
 * hand / Type the details in". A second sentence that adds nothing is not
 * neutral — it doubles the height of the sheet, halves the number of choices a
 * thumb can reach without scrolling, and teaches a musician that the small
 * grey type on this screen is never worth reading, which costs the places
 * where it is (§3 law 10).
 *
 * `SheetOptionRow.description` is optional precisely so a row can decline it.
 * It was required once, which is how all four of these came to exist.
 */
const OPTIONS = [
  { option: 'scan' as const, icon: Camera, label: 'Photograph sheet music' },
  { option: 'import' as const, icon: Images, label: 'Choose photos' },
  { option: 'notation' as const, icon: FileMusic, label: 'Open a score file' },
  { option: 'manual' as const, icon: PencilLine, label: 'Enter it by hand' },
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
 */
export function AddPieceSheet({
  visible,
  onClose,
  onSelect,
}: AddPieceSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add piece">
      {OPTIONS.map((entry, index) => (
        <SheetOptionRow
          key={entry.option}
          icon={entry.icon}
          label={entry.label}
          divided={rowDivided(index)}
          onPress={() => onSelect(entry.option)}
        />
      ))}
    </BottomSheet>
  );
}
