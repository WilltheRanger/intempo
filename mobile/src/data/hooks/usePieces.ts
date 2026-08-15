import { useQuery } from '@tanstack/react-query';

import { pieceSource } from '../sources';
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
