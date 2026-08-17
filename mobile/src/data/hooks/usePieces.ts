import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';

import { pieceSource } from '../sources';
import type { NewPiece } from '../sources/types';
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

export function usePiece(id: string) {
  return useQuery<Piece | null>({
    queryKey: pieceKeys.detail(id),
    queryFn: () => pieceSource.getPiece(id),
    enabled: Boolean(id),
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
