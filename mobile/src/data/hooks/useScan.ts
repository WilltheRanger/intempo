import { useMutation, useQueryClient } from '@tanstack/react-query';

import { pieceKeys } from './usePieces';
import { createScore } from '../api/scores';
import { IS_LIVE_BACKEND } from '../environment';
import type { Piece } from '../types';

export interface TranscribeInput {
  /**
   * Every uploaded page, in page order, from `uploadPages`.
   *
   * The order is the musician's, settled by dragging the review list before
   * anything was sent. Nothing between here and `join_pages` re-derives it.
   */
  imageUrls: string[];
  title: string;
  composer: string | null;
  /** e.g. "I. Adagio". Null for music with no movements. */
  movement: string | null;
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
          'Reading a page needs the backend. This build is running on sample data, so there is nothing to read the photograph. Enter the piece by hand instead.',
        );
      }
      const score = await createScore({
        image_urls: input.imageUrls,
        title: input.title,
        composer: input.composer,
        movement: input.movement,
      });
      return {
        id: score.id,
        title: score.title,
        composer: score.composer,
        movement: score.movement,
        lastPracticedAt: null,
        thumbnail: score.image_url,
        markedBpm: score.score_json?.bpm_hint ?? null,
        score: score.score_json ?? null,
        transcriptionStatus: score.transcription_status ?? 'done',
        transcriptionStage: score.transcription_stage ?? null,
        transcriptionError: score.transcription_error ?? null,
        transcriptionAccepted: Boolean(score.transcription_accepted_at),
        pageImageDiscarded: Boolean(score.page_image_discarded_at),
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}
