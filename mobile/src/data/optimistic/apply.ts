import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Show the result of a tap before the server has agreed to it.
 *
 * **Every mutation in this app used to wait.** Seventeen of them, none with an
 * `onMutate` — so favouriting a piece, renaming one, or correcting a bar meant
 * a tap, a pause, and then the change. On a practice-room connection that
 * pause is the whole interaction.
 *
 * This is not applied everywhere, and the exclusions are the point.
 * `acceptTranscription` discards the musician's photograph and `submitTake`
 * spends one of three free monthly analyses: showing either as done before the
 * server says so is a lie about something that cannot be taken back. Optimism
 * is for changes that can be *undone*, and this module makes undoing them the
 * default rather than an afterthought.
 *
 * Three rules live here because each is a bug when it is missing.
 */

/** Restores the cache to exactly what it held. Call once, on failure. */
export type Rollback = () => void;

/**
 * Snapshot every query under `key`, so a failure can put it all back.
 *
 * **A snapshot, not an inverse.** Undoing a rename by renaming back needs to
 * know the old name *and* that nothing else changed it in between; two edits
 * racing would leave the second one's value restored over the first. Keeping
 * the bytes sidesteps the question.
 */
export function snapshot(client: QueryClient, key: QueryKey): Rollback {
  const held = client.getQueriesData({ queryKey: key });
  return () => {
    for (const [queryKey, data] of held) {
      client.setQueryData(queryKey, data);
    }
  };
}

/**
 * Prepare the cache for an optimistic write and hand back the undo.
 *
 * **Cancels first, and that ordering is the whole safety of it.** A refetch
 * already in flight when the tap lands will resolve *after* the optimistic
 * write and overwrite it with data fetched before the change — the value flips
 * to the new one and then silently back, which reads as the tap not working.
 * `cancelQueries` is what stops that, and it has to happen before the
 * snapshot, or the snapshot captures a state the cancelled query was about to
 * replace.
 */
export async function beginOptimistic(
  client: QueryClient,
  key: QueryKey,
): Promise<Rollback> {
  await client.cancelQueries({ queryKey: key });
  return snapshot(client, key);
}

/**
 * Edit every cached copy of one row, wherever it is held.
 *
 * A piece appears in the library list, on Today, and in its own detail query.
 * Patching one and not the others is worse than patching none: the same fact
 * would read two ways on two screens, which is the failure `timedMeasures` and
 * `readTakeFailure` were both written to stop one layer up.
 */
export function patchEverywhere<T extends { id: string }>(
  client: QueryClient,
  key: QueryKey,
  id: string,
  patch: (row: T) => T,
): void {
  for (const [queryKey, data] of client.getQueriesData({ queryKey: key })) {
    if (Array.isArray(data)) {
      client.setQueryData(
        queryKey,
        (data as T[]).map((row) => (row?.id === id ? patch(row) : row)),
      );
    } else if (data && typeof data === 'object' && (data as T).id === id) {
      client.setQueryData(queryKey, patch(data as T));
    }
  }
}

/** Drop one row from every cached list and detail that holds it. */
export function removeEverywhere<T extends { id: string }>(
  client: QueryClient,
  key: QueryKey,
  id: string,
): void {
  for (const [queryKey, data] of client.getQueriesData({ queryKey: key })) {
    if (Array.isArray(data)) {
      client.setQueryData(queryKey, (data as T[]).filter((row) => row?.id !== id));
    } else if (data && typeof data === 'object' && (data as T).id === id) {
      // Null rather than removed: a detail query with no data renders the
      // screen's "couldn't open this" state, which is the truth once the row
      // is gone, where an absent key would show a spinner for ever.
      client.setQueryData(queryKey, null);
    }
  }
}
