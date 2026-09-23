import { useMutation, useQueryClient, useQuery, type QueryClient } from '@tanstack/react-query';
import {
  beginOptimistic,
  patchEverywhere,
  removeEverywhere,
  type Rollback,
} from '../optimistic/apply';

import {
  acceptTranscription,
  importScore,
  retranscribeScore,
  updateScore,
  type ImportScoreInput,
} from '../api/scores';
import { IS_LIVE_BACKEND } from '../environment';
import { pieceSource } from '../sources';
import { practiceTempo } from '../practiceTempo';
import { insightsKeys } from './useInsights';
import { pieceFromCaches } from './knownPiece';
import { takeKeys } from './useLatestTake';
import { toPiece } from '../sources/api';
import type { NewPiece, PieceEdit } from '../sources/types';
import type { Clef, Piece, ScoreJson } from '../types';
import { forgetTakesFor } from '../../lib/sync/queuedTakes';

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
/**
 * Ask for Today's piece as soon as there is a session, alongside `/v1/me`
 * rather than after it.
 *
 * The app is held behind the account (`RootNavigator`'s gate) until `/v1/me`
 * answers, and Today only mounts — and only then asks for its piece — once it
 * has. Two waits in a row, and the owner watched the title and the Practice
 * button "take like 2 seconds to load and just appear" after signing in
 * (2026-09-23). Started here, the piece is usually in by the time the gate
 * opens; `useCurrentPiece` then joins this request or reads its answer.
 */
export function prefetchCurrentPiece(client: QueryClient): void {
  void client
    .prefetchQuery({
      queryKey: pieceKeys.current(),
      queryFn: () => pieceSource.getCurrentPiece(),
    })
    .catch(() => {});
}

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

/**
 * Ask for a piece before its screen does: from the moment a finger lands on
 * it, rather than when it lifts (2026-09-23, "stuff that still takes time to
 * load"). The row already holds the title; what the screen waits on is the
 * notation, and a tap is about a tenth of a second of network the screen gets
 * for nothing.
 *
 * Never worse than not doing it: `prefetchQuery` does nothing while the piece
 * is fresh, joins a request already in flight, and a failure here is the
 * query the screen runs anyway. A scroll that starts on a piece asks for that
 * piece too — one request, kept for the `staleTime`, for a piece in view.
 */
export function prefetchPiece(client: QueryClient, id: string): void {
  void client
    .prefetchQuery({
      queryKey: pieceKeys.detail(id),
      queryFn: () => pieceSource.getPiece(id),
    })
    .catch(() => {});
}

export function usePiece(id: string) {
  const queryClient = useQueryClient();
  return useQuery<Piece | null>({
    queryKey: pieceKeys.detail(id),
    queryFn: () => pieceSource.getPiece(id),
    enabled: Boolean(id),
    /**
     * Open on what the library already told us, not on a blank screen.
     *
     * Tapping a piece used to push a screen that rendered `LoadingState` and
     * then replaced it — reported as "it's like waiting to load and then
     * loads". The row that was tapped already held this piece's title,
     * composer, movement and cover, fetched and rendered a moment earlier, and
     * the detail screen threw all of it away to ask again.
     *
     * `placeholderData` rather than `initialData`, deliberately: `initialData`
     * is written into the cache as if it were a real answer and inherits the
     * query's staleness, so a thin listing row would be *stored* as the piece.
     * A placeholder is never cached, is flagged by `isPlaceholderData`, and the
     * real fetch still runs underneath and replaces it.
     */
    placeholderData: () =>
      pieceFromCaches(
        id,
        queryClient.getQueryData<Piece[]>(pieceKeys.list()),
        queryClient.getQueryData<Piece | null>(pieceKeys.current()),
      ),
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
  return useMutation<Piece, Error, PieceEdit, Rollback>({
    mutationFn: (input) => pieceSource.updatePiece(id, input),
    // **Shown before the server agrees, and taken back if it disagrees.** A
    // rename or a favourite is reversible, which is the whole test for whether
    // optimism is honest here: `acceptTranscription` and `submitTake`
    // deliberately still wait, because neither can be undone.
    onMutate: async (input) => {
      const undo = await beginOptimistic(queryClient, pieceKeys.all);
      patchEverywhere<Piece>(queryClient, pieceKeys.all, id, (piece) => ({
        ...piece,
        ...input,
      }));
      return undo;
    },
    onError: (_error, _input, undo) => undo?.(),
    onSettled: () => {
      // The title appears on Today, in the library, in insights and on the
      // verdict screen, so this invalidates everything rather than patching
      // the detail entry and leaving four stale copies of the old name.
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}

/**
 * Permanently removes a piece and the history that belongs to it.
 *
 * The endpoint clears the server-side score, assignments, analyses, recordings
 * and retained pages. The client clears its one piece-scoped device value and
 * refreshes every query derived from that history so Today and Insights cannot
 * keep showing a take that no longer exists.
 */
export function useDeletePiece() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string, Rollback>({
    mutationFn: (id) => pieceSource.deletePiece(id),
    // The row goes from every list immediately; a failure puts it back exactly
    // where it was. `practiceTempo` is *not* cleared here — that is a device
    // value the server knows nothing about, and clearing it optimistically
    // would lose a musician's tempo for a delete that then failed.
    onMutate: async (id) => {
      const undo = await beginOptimistic(queryClient, pieceKeys.all);
      removeEverywhere<Piece>(queryClient, pieceKeys.all, id);
      return undo;
    },
    onError: (_error, _id, undo) => undo?.(),
    onSettled: async (_data, _error, id) => {
      practiceTempo.clear(id);
      // **And its unsent takes**, which nothing removed. The WAV is up to 50 MB
      // and the only thing that ever dropped an entry unasked was noticing its
      // bytes were gone — and they are not. It is not inert either: the drain
      // retries it for ever against a score the server answers 404 for, and a
      // pass stops at the first failure, so one orphan blocks every real take
      // behind it.
      //
      // In `onSettled` rather than `onMutate`: a delete that fails is undone
      // above, and a take thrown away optimistically could not be.
      void forgetTakesFor(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pieceKeys.all }),
        queryClient.invalidateQueries({ queryKey: takeKeys.all }),
        queryClient.invalidateQueries({ queryKey: insightsKeys.all }),
      ]);
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

/**
 * Saves a corrected transcription.
 *
 * Not on `PieceSource` like the other writes, for the same reason
 * `useTranscribePage` isn't: the sample build has no server to correct
 * anything on, and pretending a correction persisted when it lives in memory
 * until reload would be a lie about the one screen whose whole job is to make
 * the score trustworthy.
 *
 * Sends the **whole** `score_json`, not a patch. The backend's
 * `UpdateScoreRequest.score_json` is a full `ScoreJson` and validates it as
 * one, so a partial object would be rejected by Pydantic — and a
 * measure-level PATCH API would be a second way to write scores that has to
 * agree with the first.
 */
export function useCorrectScore(id: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ScoreJson>({
    mutationFn: async (score) => {
      if (!IS_LIVE_BACKEND) {
        throw new Error(
          'Correcting a score needs the backend. This build runs on sample data.',
        );
      }
      await updateScore(id, { score_json: score });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}

/**
 * Sets — or clears — the clef, without touching the notes.
 *
 * Whoever read the page can be wrong about this in either direction, and no
 * amount of reading settles it: a double bass **solo** part is written in
 * treble, and a bass or cello part goes into tenor for a high passage. Nor does
 * the instrument settle it, which is why nothing here derives one — a cello
 * reads bass clef too. The player knows and nothing else does.
 *
 * `null` is a real value, not a way of saying "unchanged": a part can honestly
 * be unlabelled, and `ScoreJson.clef` is nullable so that it can be. Sending
 * `undefined` is what leaves it alone, and that is `updateScore`'s contract
 * rather than this hook's — the key drops out of the JSON body.
 *
 * Not on `PieceSource`, like the other server-only writes. A sample build has
 * nothing to write to.
 */
export function useSetClef(id: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, Clef | null, Rollback>({
    // A clef is one word and entirely reversible — "Not stated" is a real
    // choice here, so the control has to feel like a control rather than a
    // request. It is also the one field a musician corrects while looking
    // straight at the stave it redraws.
    onMutate: async (clef) => {
      const undo = await beginOptimistic(queryClient, pieceKeys.all);
      patchEverywhere<Piece>(queryClient, pieceKeys.all, id, (piece) =>
        piece.score ? { ...piece, score: { ...piece.score, clef } } : piece,
      );
      return undo;
    },
    onError: (_error, _clef, undo) => undo?.(),
    mutationFn: async (clef) => {
      if (!IS_LIVE_BACKEND) {
        throw new Error(
          'Setting the clef needs the backend. This build runs on sample data.',
        );
      }
      await updateScore(id, { clef });
    },
    // **`onSettled`, not `onSuccess`.** After a failure the rollback restores
    // what this client believed was there, which is not necessarily what the
    // server holds — only a refetch knows. Re-syncing on both outcomes is what
    // stops an optimistic write leaving the cache subtly wrong.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}

/**
 * Asks for the page to be read again.
 *
 * Invalidates rather than patching: the row goes back to `queued` and
 * `usePiece` starts polling again, which is the state the screen keys off.
 *
 * **The id is the mutation's argument, not the hook's**, because the library
 * offers this from a shelf of tiles and a hook cannot be called per tile.
 * `useDeletePiece` is shaped the same way and for the same reason.
 */
export function useRetranscribe() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      if (!IS_LIVE_BACKEND) {
        throw new Error(
          'Reading a page again needs the backend. This build runs on sample data.',
        );
      }
      await retranscribeScore(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}

/**
 * Brings in a piece from a notation file.
 *
 * Not on `PieceSource` like the other writes, for the reason the other
 * server-only mutations aren't: the sample build has no backend to parse XML,
 * and a fixture that returned a piece the file never described would make the
 * one route whose selling point is *exactness* the one route that invents
 * things.
 *
 * Returns the piece rather than void — the caller navigates straight to it,
 * and unlike the camera path there is no reading state to wait through.
 */
export function useImportPiece() {
  const queryClient = useQueryClient();
  return useMutation<Piece, Error, ImportScoreInput>({
    mutationFn: async (input) => {
      if (!IS_LIVE_BACKEND) {
        throw new Error(
          'Importing a file needs the backend. This build runs on sample data.',
        );
      }
      return toPiece(await importScore(input));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pieceKeys.all });
    },
  });
}
