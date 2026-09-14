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

const OPTIONS = [
  {
    option: 'scan' as const,
    icon: Camera,
    label: 'Photograph sheet music',
    description: 'Use the camera on the pages in front of you.',
  },
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
          description={entry.description}
          divided={rowDivided(index)}
          onPress={() => onSelect(entry.option)}
        />
      ))}
    </BottomSheet>
  );
}
