import { Camera, Images, PencilLine } from 'lucide-react-native';

import { BottomSheet } from '../../components/overlays/BottomSheet';
import { SheetOptionRow } from '../../components/overlays/SheetOptionRow';
import type { AddPieceOption } from '../../navigation/types';

export interface AddPieceSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (option: AddPieceOption) => void;
}

const OPTIONS = [
  {
    option: 'scan' as const,
    icon: Camera,
    label: 'Scan sheet music',
    description: 'Take photos of physical sheet music.',
  },
  {
    option: 'import' as const,
    icon: Images,
    label: 'Import score',
    description: 'Choose existing images or a PDF.',
  },
  {
    option: 'manual' as const,
    icon: PencilLine,
    label: 'Add manually',
    description: 'Create a piece without transcription.',
  },
];

/** The three ways a piece enters the library. */
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
          divided={index > 0}
          onPress={() => onSelect(entry.option)}
        />
      ))}
    </BottomSheet>
  );
}
