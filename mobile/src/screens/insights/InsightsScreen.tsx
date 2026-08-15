import { ChartLine } from 'lucide-react-native';

import {
  EmptyState,
  PageHeader,
  ScreenContainer,
} from '../../components/primitives';

/**
 * Placeholder.
 *
 * Insights needs data that does not exist: it would aggregate across
 * `analyses`, and neither the analysis pipeline (Batch 3) nor the
 * `/v1/analyses` endpoints (Batch 4) are built. Worth confirming what this
 * screen should actually show before designing it.
 */
export function InsightsScreen() {
  return (
    <ScreenContainer>
      <PageHeader title="Insights" />
      <EmptyState
        icon={ChartLine}
        title="Not built yet"
        description="Insights needs practice history from the analysis pipeline, which isn't built on the backend yet."
      />
    </ScreenContainer>
  );
}
