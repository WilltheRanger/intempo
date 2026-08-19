import { useRoute, type RouteProp } from '@react-navigation/native';

import type { RootStackParamList } from '../../navigation/types';
import { ImportPagesScreen } from './ImportPages';
import { ManualPieceForm } from './ManualPieceForm';

/**
 * Where the two non-camera Add Piece options land.
 *
 * Both are real screens now. This is the fork and nothing else — it used to
 * carry an "Import score — not built yet" placeholder in its own body, which is
 * why it still owns the route rather than the two screens owning one each.
 */
export function AddPieceScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'AddPiece'>>();

  return params.option === 'manual' ? <ManualPieceForm /> : <ImportPagesScreen />;
}
