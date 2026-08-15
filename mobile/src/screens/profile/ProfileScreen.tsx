import { User } from 'lucide-react-native';

import {
  EmptyState,
  PageHeader,
  ScreenContainer,
} from '../../components/primitives';

/**
 * Placeholder. Phase 5.
 *
 * Of the four tabs this one is closest to buildable — `GET /v1/me` already
 * returns email, tier, and role.
 */
export function ProfileScreen() {
  return (
    <ScreenContainer>
      <PageHeader title="Profile" />
      <EmptyState
        icon={User}
        title="Not built yet"
        description="Account details land in Phase 5."
      />
    </ScreenContainer>
  );
}
