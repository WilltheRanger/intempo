import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';

import { acceptTranscription } from '../api/scores';
import { IS_LIVE_BACKEND } from '../environment';
import { pieceSource } from '../sources';
import type { NewPiece, PieceEdit } from '../sources/types';
import type { Piece } from '../types';

export const pieceKeys = {
  all: ['pieces'] as const,
  list: () => [...pieceKeys.all, 'list'] as const,
  current: () => [...pieceKeys.all, 'current'] as const,
  detail: (id: string) => [...pieceKeys.all, 'detail', id] as const,
};

/** The full repertoire. */
export function useLibrary() {
  return useQuery<Piece[]>({
    queryKey: pieceKeys.list(),
    queryFn: () => pieceSource.listPieces(),
  });
}

/** The piece the Today screen leads with. */
export function useCurrentPiece() {
  return useQuery<Piece | null>({
    queryKey: pieceKeys.current(),
    queryFn: () => pieceSource.getCurrentPiece(),
  });
}

/**
 * How often to ask again while a page is being read.
 *
 * Three seconds. The whole job is tens of seconds long, so this is a handful
 * of requests, and the stage line it refreshes is the only thing on the screen
 * that changes — a slower poll would leave "Fetching the page" up while the
 * model was already halfway through the notation, which is worse than no
 * detail at all.
 */
const TRANSCRIPTION_POLL_MS = 3000;

export function usePiece(id: string) {
  return useQuery<Piece | null>({
    queryKey: pieceKeys.detail(id),
    queryFn: () => pieceSource.getPiece(id),
    enabled: Boolean(id),
    // Keep asking only while there is an answer coming. `queued` and `reading`
    // are the two states a worker is going to move off; `done` and `failed`
    // are terminal, and polling either would be asking a settled question
    // forever.
    refetchInterval: (query) => {
      const status = query.state.data?.transcriptionStatus;
      return status === 'queued' || status === 'reading' ? TRANSCRIPTION_POLL_MS : false;
    },
  });
}

/**
 * Adds a piece the musician typed in.
 *
 * Invalidates every piece query rather than writing the new one into the
 * cache: the server decides the id and the ordering, and a hand-placed entry
 * that disagrees with the next fetch is the kind of bug that shows up as a
 * piece appearing twice. One extra request buys correctness on a screen the
 * musician has just left.
 */
export function useCreatePiece() {
  const queryClient = useQueryClient();
  return useMutation<Piece, Error, NewPiece>({
    mutationFn: (input) => pieceSource.createPiece(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}

/** Corrects a piece's title or composer. */
export function useUpdatePiece(id: string) {
  const queryClient = useQueryClient();
  return useMutation<Piece, Error, PieceEdit>({
    mutationFn: (input) => pieceSource.updatePiece(id, input),
    onSuccess: () => {
      // The title appears on Today, in the library, in insights and on the
      // verdict screen, so this invalidates everything rather than patching
      // the detail entry and leaving four stale copies of the old name.
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}

/**
 * Removes a piece from the library.
 *
 * Expect this to reject: a piece that has been recorded against cannot be
 * deleted, and the rejection carries the backend's own sentence explaining
 * why. Callers must render it rather than treating it as a retryable error.
 */
export function useDeletePiece() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => pieceSource.deletePiece(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}

/**
 * Confirms a transcription is right, which discards the photograph.
 *
 * Not on `PieceSource` like the other writes, and for the same reason
 * `useTranscribePage` isn't: there is no fixture equivalent worth having. The
 * sample build has no storage to delete from, and faking the deletion would
 * make a destructive action look rehearsed in the one build where it does
 * nothing.
 *
 * Invalidates rather than writing the result into the cache: the piece loses
 * its image URL, and every screen showing a thumbnail of it has to hear about
 * that from the server rather than from a hand-patched cache entry.
 */
export function useAcceptTranscription(id: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!IS_LIVE_BACKEND) {
        throw new Error(
          'Accepting a transcription needs the backend. This build runs on sample data.',
        );
      }
      await acceptTranscription(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}
