import { useMutation, useQueryClient } from '@tanstack/react-query';

import { pieceKeys } from './usePieces';
import { attachScorePages, createScore } from '../api/scores';
import { IS_LIVE_BACKEND } from '../environment';
import type { Piece } from '../types';
import { toPiece } from '../sources/api';

export interface TranscribeInput {
  /** Ordered owner-prefixed object keys from `uploadPage`. */
  imageKeys: string[];
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
      if (input.imageKeys.length === 0) {
        throw new Error('At least one uploaded page is required.');
      }
      const images =
        input.imageKeys.length === 1
          ? { image_url: input.imageKeys[0] }
          : { image_urls: input.imageKeys };
      const score = await createScore({
        ...images,
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

/** Reads uploaded pages into an existing manual piece instead of duplicating it. */
export function useAttachScorePages(pieceId: string) {
  const queryClient = useQueryClient();
  return useMutation<Piece, Error, string[]>({
    mutationFn: async (imageKeys) => {
      if (!IS_LIVE_BACKEND) {
        throw new Error('Attaching sheet music needs the backend.');
      }
      if (!pieceId || imageKeys.length === 0) {
        throw new Error('Choose at least one page to attach.');
      }
      const images =
        imageKeys.length === 1
          ? { image_url: imageKeys[0] }
          : { image_urls: imageKeys };
      return toPiece(await attachScorePages(pieceId, images));
    },
    onSuccess: (piece) => {
      queryClient.setQueryData(pieceKeys.detail(piece.id), piece);
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}
