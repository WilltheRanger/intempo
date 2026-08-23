import { useRoute, type RouteProp } from '@react-navigation/native';

import type { RootStackParamList } from '../../navigation/types';
import { ImportFileScreen } from './ImportFile';
import { ImportPagesScreen } from './ImportPages';
import { ManualPieceForm } from './ManualPieceForm';

/**
 * Where the three non-camera Add Piece options land.
 *
 * All three are real screens. This is the fork and nothing else — it used to
 * carry an "Import score — not built yet" placeholder in its own body, which is
 * why it still owns the route rather than each screen owning one.
 */
export function AddPieceScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'AddPiece'>>();

  switch (params.option) {
    case 'manual':
      return <ManualPieceForm />;
    case 'notation':
      return <ImportFileScreen />;
    default:
      return <ImportPagesScreen />;
  }
}
