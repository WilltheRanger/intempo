import { useMutation, useQueryClient } from '@tanstack/react-query';

import { pieceKeys } from './usePieces';
import { createScore } from '../api/scores';
import { IS_LIVE_BACKEND } from '../environment';
import type { Piece } from '../types';

export interface TranscribeInput {
  /** The signed upload URL from `uploadPage`. Expires five minutes after issue. */
  imageUrl: string;
  title: string;
  composer: string | null;
}

/**
 * Creating a score from an uploaded page — the step that runs OCR.
 *
 * Not on `PieceSource` like the other writes, and deliberately so: there is no
 * fixture equivalent. Every other seam has two honest implementations, but
 * "read this photograph" cannot be faked without inventing notes that were
 * never on the page, and a fabricated transcription is the single most
 * misleading thing this app could produce. A build with no backend refuses
 * instead — see below.
 *
 * Takes 10–14 seconds against the real backend (EDIT_LOG, Batch 2), because OCR
 * runs inline inside `POST /v1/scores`. The caller needs a real pending state,
 * which is why this is a mutation rather than a fire-and-forget.
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
        image_url: input.imageUrl,
        title: input.title,
        composer: input.composer,
      });
      return {
        id: score.id,
        title: score.title,
        composer: score.composer,
        movement: null,
        lastPracticedAt: null,
        thumbnail: score.image_url,
        markedBpm: score.score_json?.bpm_hint ?? null,
        score: score.score_json ?? null,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}
