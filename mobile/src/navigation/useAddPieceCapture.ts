import { useNavigation } from '@react-navigation/native';

import { motion } from '../design';
import type { RootNavigation } from './types';

/**
 * Handles a photograph taken inline in the add-piece sheet, from any screen
 * that offers it.
 *
 * The counterpart to `useAddPieceOption`, for the one option that no longer
 * routes through `addPieceDestination`: a scan started this way already has
 * its first page in `captureSession` by the time this runs (`AddPieceSheet`
 * put it there), so there is no `Scanner` route to open — just the sheet to
 * close and `CapturedPages` to show.
 *
 * Same wait as `useAddPieceOption`, and for the same reason: closing the
 * sheet and navigating in the same frame runs the sheet's exit animation
 * against the screen's entrance.
 */
export function useAddPieceCapture(closeSheet: () => void) {
  const navigation = useNavigation<RootNavigation>();

  return () => {
    closeSheet();
    setTimeout(() => {
      navigation.navigate('CapturedPages');
    }, motion.fast);
  };
}
