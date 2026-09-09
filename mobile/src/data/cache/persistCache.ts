import type { Piece } from '../types';

/**
 * What of the library is written to the device, and what is thrown away.
 *
 * **The app queues takes offline and could not read a note offline.** A take
 * recorded out of signal is kept and sent later (`lib/sync/takeDrainer`), which
 * is the harder half of practising without a connection — and yet relaunching
 * the app in a basement rehearsal room showed an empty library, because every
 * screen's data lived in a React Query cache that exists only for the life of
 * the process. The musician could record into a piece they could not open.
 *
 * These are the rules for closing that. They are here rather than in the
 * persister's options object for the reason this codebase keeps rediscovering:
 * a rule with no test is a rule nothing checks, and two of the three below are
 * about *not* writing something — the kind of mistake that is invisible until
 * it is a support ticket.
 */

/** One key in AsyncStorage. Namespaced so it is obvious where it came from. */
export const CACHE_KEY = 'intempo.library-cache';

/**
 * Bumped whenever what is written here changes shape.
 *
 * Part of the buster, so a build that reads the old shape discards it rather
 * than hydrating a `Piece` that is missing a field the screens now require.
 * Changing `pieceForDisk` below is the trigger; adding a key root is not,
 * because an unknown key simply never matches.
 */
export const CACHE_SHAPE = 1;

/**
 * How long a saved library is still worth showing.
 *
 * Fourteen days. The thing being restored is titles, composers and notation —
 * facts about music that do not go stale on a human timescale — so this is not
 * a freshness window, it is a floor under how much dead weight one device
 * carries. Anything younger is replaced by a real fetch the moment there is
 * signal, because every one of these queries refetches on mount past
 * `STALE_TIME_MS`.
 */
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The most this may occupy, in characters of JSON.
 *
 * **Two megabytes, and the number is the notation.** A piece's `score_json` is
 * around 111 bytes a note, so a fifty-piece library's worth of it is megabytes
 * on its own — `pieceForDisk` drops it from the listing for exactly that
 * reason, and this is the backstop for the pieces that keep it. Web stores
 * this in `localStorage`, whose quota is about five megabytes *for the whole
 * origin*, shared with the Supabase session and the take queue; Android's
 * AsyncStorage is a SQLite database with a six-megabyte default. Two leaves
 * room in both for the things that are not this.
 */
export const BUDGET_CHARS = 2_000_000;

/**
 * The account a cache belongs to, and the shape it was written in.
 *
 * **A buster rather than a per-account storage key**, because the failure this
 * prevents is one musician seeing another's repertoire on a shared device and
 * a buster is checked by the library itself on restore: a mismatch removes the
 * stored client instead of hydrating it. A per-account key would leave the
 * previous account's copy on disk, correct but lingering — this way the next
 * sign-in collects it.
 */
export function busterFor(accountId: string): string {
  return `${CACHE_SHAPE}:${accountId}`;
}

type Kind = 'list' | 'current' | 'detail';

/**
 * Whether a query is one of the ones kept, and which kind it is.
 *
 * **An allow-list, not a deny-list.** Everything else in the cache either
 * expires (a signed recording URL), is cheap to refetch (the profile row), or
 * is a number that would be wrong the moment it was read back (this week's
 * practice minutes). Persisting a screen's worth of stale figures with nothing
 * saying they are stale is worse than the skeleton it replaces; a piece of
 * music is not, which is the whole distinction this list encodes.
 */
export function persistedKind(queryKey: readonly unknown[]): Kind | null {
  if (queryKey[0] !== 'pieces') {
    return null;
  }
  if (queryKey.length === 2 && queryKey[1] === 'list') {
    return 'list';
  }
  if (queryKey.length === 2 && queryKey[1] === 'current') {
    return 'current';
  }
  if (queryKey.length === 3 && queryKey[1] === 'detail') {
    return 'detail';
  }
  return null;
}

/** Successful piece queries, and nothing else. */
export function shouldPersist(queryKey: readonly unknown[], status: string): boolean {
  return status === 'success' && persistedKind(queryKey) !== null;
}

/**
 * A piece with the parts that cannot survive the trip removed.
 *
 * **Signed URLs are good for an hour**, and the point of this cache is the next
 * morning. A restored `thumbnail` would be a link the storage host now refuses,
 * which renders as a broken box; `null` renders as `ScoreThumbnail`'s ruled
 * staves, which is a state the app already draws deliberately and a musician
 * already recognises. Dropping them is choosing the known-good absence over the
 * plausible-looking failure.
 *
 * `keepNotation` is false for the listing alone. The library grid draws a
 * title, a composer and a photograph — it has never read a note — and
 * `pieceFromCaches` already documents that a listed piece's `score` may be
 * absent, so this writes a placeholder the app is built to receive rather than
 * inventing a new one. It is also the entire size problem: with notation, one
 * query is the whole budget.
 */
export function pieceForDisk(piece: Piece, keepNotation: boolean): Piece {
  return {
    ...piece,
    thumbnail: null,
    pages: [],
    score: keepNotation ? piece.score : null,
  };
}

function dataForDisk(kind: Kind, data: unknown): unknown {
  if (kind === 'list') {
    return Array.isArray(data) ? data.map((piece) => pieceForDisk(piece as Piece, false)) : data;
  }
  // `current` is null for an account that has not practised yet, and `detail`
  // is null for a piece that has been deleted in another session. Both are real
  // answers worth keeping — the screens render them — so only an object is
  // rewritten.
  return data && typeof data === 'object' ? pieceForDisk(data as Piece, true) : data;
}

/** The dehydrated query shape, structurally — see the note in `takeFailure`. */
interface StoredQuery {
  queryKey: readonly unknown[];
  state: { status?: string; dataUpdatedAt?: number; data?: unknown };
}

interface StoredClient {
  timestamp: number;
  buster: string;
  clientState: { mutations: unknown[]; queries: StoredQuery[] };
}

/** Listing and today's piece first, then the pieces opened most recently. */
const ORDER: Record<Kind, number> = { list: 0, current: 1, detail: 2 };

function inPriorityOrder(queries: StoredQuery[]): { kind: Kind; query: StoredQuery }[] {
  const kept = queries.flatMap((query) => {
    const kind = persistedKind(query.queryKey);
    return kind ? [{ kind, query }] : [];
  });
  return kept.sort((a, b) => {
    if (ORDER[a.kind] !== ORDER[b.kind]) {
      return ORDER[a.kind] - ORDER[b.kind];
    }
    // Newest first, so a full library trims to the pieces this musician has
    // actually been opening — which are the ones they will open in the room.
    return (b.query.state.dataUpdatedAt ?? 0) - (a.query.state.dataUpdatedAt ?? 0);
  });
}

/**
 * The cache as it goes to disk: stripped, ordered, and inside the budget.
 *
 * **One function rather than the library's `dehydrateOptions.serializeData`**,
 * because that hook is handed a query's data with no key, and every rule above
 * turns on which query it is. Serialising the whole client is also the only
 * place the size of the result is knowable.
 *
 * Over budget, a query is **skipped and the walk continues** rather than
 * stopping the loop. A single oversized piece — a movement with several
 * thousand notes — would otherwise take everything after it down with it, and
 * the smaller pieces behind it fit perfectly well.
 *
 * Mutations are never written. Nothing here pauses one (`mutations.retry` is
 * false, and the note in `queryClient` says why), so the only thing persisting
 * them could do is replay a take on a future launch.
 */
export function serializeForDisk(client: StoredClient, budget = BUDGET_CHARS): string {
  const empty: StoredClient = {
    ...client,
    clientState: { mutations: [], queries: [] },
  };
  const queries: StoredQuery[] = [];
  let size = JSON.stringify(empty).length;

  for (const { kind, query } of inPriorityOrder(client.clientState.queries)) {
    const stored: StoredQuery = {
      ...query,
      state: { ...query.state, data: dataForDisk(kind, query.state.data) },
    };
    // The comma this entry would need once it is not the first one.
    const cost = JSON.stringify(stored).length + (queries.length ? 1 : 0);
    if (size + cost > budget) {
      continue;
    }
    queries.push(stored);
    size += cost;
  }

  return JSON.stringify({ ...empty, clientState: { mutations: [], queries } });
}
