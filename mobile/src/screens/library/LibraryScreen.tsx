import { Library } from 'lucide-react-native';

import {
  EmptyState,
  PageHeader,
  ScreenContainer,
} from '../../components/primitives';

/**
 * Placeholder. The Library screen is Phase 5 — it waits until the Today
 * screen's visual system is approved, so it inherits settled components
 * instead of a second set that has to be reconciled later.
 */
export function LibraryScreen() {
  return (
    <ScreenContainer>
      <PageHeader title="Library" />
      <EmptyState
        icon={Library}
        title="Not built yet"
        description="The library lands in Phase 5, once the Today screen is signed off."
      />
    </ScreenContainer>
  );
}
