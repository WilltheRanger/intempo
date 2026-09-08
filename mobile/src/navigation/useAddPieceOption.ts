import { useNavigation } from '@react-navigation/native';

import { motion } from '../design';
import { addPieceDestination } from './addPieceDestination';
import type { AddPieceOption, RootNavigation } from './types';

/**
 * Handles a choice made in the add-piece sheet, from any screen that offers it.
 *
 * Three screens offered it and three screens implemented it identically. The
 * routing rule now lives in `addPieceDestination` with tests; this is the other
 * half — closing the sheet, and waiting for it to finish.
 *
 * **The wait is the part that reads as a bug when it is missing.** Navigating
 * in the same frame as the dismissal runs the sheet's exit and the screen's
 * entrance over each other, so the sheet appears to be dragged sideways off the
 * screen by the push. `motion.fast` is the sheet's own exit duration, so this
 * is the same number rather than a guess that happens to match.
 */
export function useAddPieceOption(closeSheet: () => void) {
  const navigation = useNavigation<RootNavigation>();

  return (option: AddPieceOption) => {
    closeSheet();
    setTimeout(() => {
      const destination = addPieceDestination(option);
      // The union of every route and its own params is exactly what `navigate`
      // accepts and exactly what TypeScript cannot narrow across a mapped type.
      // Cast once, here, as `useGoBack` does for the same reason.
      (navigation.navigate as (route: string, params?: object) => void)(
        destination.route,
        'params' in destination ? destination.params : undefined,
      );
    }, motion.fast);
  };
}
