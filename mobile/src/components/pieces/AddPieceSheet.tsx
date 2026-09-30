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
 * **Four labels, and no line under any of them** — the owner, 2026-09-30:
 * "remove all the text underneath … Its super redundant as the user will know
 * what that means". The labels name what you have in your hand, and that is
 * the whole choice.
 *
 * This is the second time the lines have gone. They were cut once for saying
 * each label again ("Photograph sheet music / Use the camera on the pages in
 * front of you"), which doubled the sheet's height, halved what a thumb could
 * reach without scrolling, and taught a musician that the small grey type here
 * is never worth reading (§3 law 10). They came back on 2026-09-29 as lines
 * meant to add something — "Recommended", the file formats, what a hand-typed
 * piece lacks — after a first-time walk hesitated between the four. The owner
 * judged those redundant too. The two that carried something are said where
 * they matter: the manual form's "Photograph the music to listen, record, and
 * get timing", and the score-file screen's "From MuseScore, Sibelius or Finale".
 *
 * `SheetOptionRow.description` stays optional, so a row can still decline it.
 */
const OPTIONS = [
  {
    option: 'scan' as const,
    icon: Camera,
    label: 'Photograph sheet music',
  },
  {
    option: 'import' as const,
    icon: Images,
    label: 'Choose photos',
  },
  {
    option: 'notation' as const,
    icon: FileMusic,
    label: 'Open a score file',
  },
  {
    option: 'manual' as const,
    icon: PencilLine,
    label: 'Enter it by hand',
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
          divided={rowDivided(index)}
          onPress={() => onSelect(entry.option)}
        />
      ))}
    </BottomSheet>
  );
}
