import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deletePiece = vi.fn<(id: string) => Promise<void>>();
const clearTempo = vi.fn<(id: string) => void>();
const forgetTakesFor = vi.fn<(id: string) => Promise<void>>(async () => {});

vi.mock('../sources', () => ({
  pieceSource: { deletePiece: (id: string) => deletePiece(id) },
  takeSource: {},
  insightsSource: {},
}));
vi.mock('../sources/api', () => ({ toPiece: (piece: unknown) => piece }));
// `api/scores` reaches the API client, and through it react-native.
vi.mock('../api/scores', () => ({}));
vi.mock('../practiceTempo', () => ({
  practiceTempo: { clear: (id: string) => clearTempo(id) },
}));
vi.mock('../../lib/sync/queuedTakes', () => ({
  forgetTakesFor: (id: string) => forgetTakesFor(id),
}));

// The hook is two calls into React Query. Outside a component, hand back the
// options it builds and the client it would have been given, so the real
// mutation lifecycle below runs them.
const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => client,
  useMutation: (options: unknown) => options,
}));

// Imported under another name because, with the two hooks above mocked, it is
// no longer one: it calls nothing that needs a component, and the lint rule
// that guards hook order is reading the name, not the behaviour.
import { useDeletePiece as deletePieceOptions } from './usePieces';

/**
 * A piece's device state goes only when the server has deleted the piece.
 *
 * **A failed delete is put back, so its takes must still be there.** The
 * practice tempo and the unsent takes were cleared in `onSettled`, which React
 * Query runs after a failure as well as a success — so deleting a piece with no
 * signal, or against a 5xx, restored the row and silently threw away the WAVs
 * queued for it. A take is a performance; it cannot be fetched back.
 */
function run(id: string): Promise<unknown> {
  const options = deletePieceOptions() as unknown as ConstructorParameters<
    typeof MutationObserver<void, Error, string, unknown>
  >[1];
  return new MutationObserver<void, Error, string, unknown>(client, options)
    .mutate(id)
    .catch(() => undefined);
}

describe('deleting a piece', () => {
  beforeEach(() => {
    deletePiece.mockReset();
    clearTempo.mockReset();
    forgetTakesFor.mockClear();
  });

  it('forgets its tempo and unsent takes once the server has deleted it', async () => {
    deletePiece.mockResolvedValue(undefined);
    await run('piece-1');
    expect(clearTempo).toHaveBeenCalledWith('piece-1');
    expect(forgetTakesFor).toHaveBeenCalledWith('piece-1');
  });

  it('keeps both when the delete fails and the piece is put back', async () => {
    deletePiece.mockRejectedValue(new Error('offline'));
    await run('piece-1');
    expect(clearTempo).not.toHaveBeenCalled();
    expect(forgetTakesFor).not.toHaveBeenCalled();
  });
});
