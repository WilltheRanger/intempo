import { useMutation, useQueryClient } from '@tanstack/react-query';

import { pieceKeys } from './usePieces';
import { createScore } from '../api/scores';
import { IS_LIVE_BACKEND } from '../environment';
import type { Piece } from '../types';
import { toPiece } from '../sources/api';

export interface TranscribeInput {
  /** Ordered signed upload URLs from `uploadPage`. */
  imageUrls: string[];
  title: string;
  composer: string | null;
  /** e.g. "I. Adagio". Null for music with no movements. */
  movement: string | null;
}

/**
 * Creating a score from uploaded pages — the step that runs OCR.
 *
 * Not on `PieceSource` like the other writes, and deliberately so: there is no
 * fixture equivalent. Every other seam has two honest implementations, but
 * "read these photographs" cannot be faked without inventing notes that were
 * never on the page, and a fabricated transcription is the single most
 * misleading thing this app could produce. A build with no backend refuses
 * instead — see below.
 *
 * **Returns as soon as the piece exists, not when it has been read.** OCR used
 * to run inside `POST /v1/scores` and this used to be pending for the ten to
 * sixty seconds that took — a request held open across a screen the musician
 * could background, which is how "the pipeline gets stuck" happened. The
 * backend now writes the row and reads the page in a worker, so this resolves
 * in the ordinary time a request takes and the piece it returns has
 * `transcriptionStatus: 'queued'`. Watching the rest is `usePiece`'s job.
 */
export function useTranscribePage() {
  const queryClient = useQueryClient();
  return useMutation<Piece, Error, TranscribeInput>({
    mutationFn: async (input) => {
      if (!IS_LIVE_BACKEND) {
        throw new Error(
          'Transcription needs the backend. This build is running on sample data, so there is nothing to read the photograph. Add a piece manually instead.',
        );
      }
      const score = await createScore({
        image_urls: input.imageUrls,
        title: input.title,
        composer: input.composer,
        movement: input.movement,
      });
      return toPiece(score);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}
