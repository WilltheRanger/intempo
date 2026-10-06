import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { listCorrections, postCorrections, type SavedCorrection } from '../api/corrections';
import { IS_LIVE_BACKEND } from '../environment';
import type { CorrectionInput } from '../types';

export interface SubmitCorrectionInput {
  analysisId: string;
  corrections: CorrectionInput[];
}

/**
 * Telling the app a bar's verdict was wrong.
 *
 * **Not on a source seam**, and for the reason `useUpdateProfile` is not: a
 * build running on sample data has nothing to write to, and a mutation that
 * silently succeeded against a fixture would teach the screen a lie about what
 * it had recorded. A correction is feedback the musician never sees again —
 * which makes a false "Noted." easier to ship and no less false.
 *
 * Nothing is invalidated on success. The take's verdict does not change: this
 * is a note to whoever tunes the thresholds, and refetching the analysis would
 * imply the reading had been revised.
 */
export function useSubmitCorrection() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, SubmitCorrectionInput>({
    mutationFn: async ({ analysisId, corrections }) => {
      if (!IS_LIVE_BACKEND) {
        throw new Error(
          'Sending feedback needs the backend. This build is running on sample data.',
        );
      }
      await postCorrections(analysisId, corrections);
    },
    // The answers already given, not the take: coming back to this result
    // should find the one just sent (`useSavedCorrections`).
    onSuccess: (_data, { analysisId }) =>
      queryClient.invalidateQueries({ queryKey: correctionKeys.forTake(analysisId) }),
  });
}

export const correctionKeys = {
  forTake: (analysisId: string) => ['corrections', analysisId] as const,
};

/**
 * What the musician already said about this take, so the question is not
 * asked again as if it had never been answered. Off on sample data, which has
 * no answers to hold; the screen then asks, as before.
 */
export function useSavedCorrections(analysisId: string) {
  return useQuery<SavedCorrection[]>({
    queryKey: correctionKeys.forTake(analysisId),
    queryFn: () => listCorrections(analysisId),
    enabled: IS_LIVE_BACKEND && Boolean(analysisId),
  });
}
