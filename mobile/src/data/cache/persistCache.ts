import type { Musician, Piece } from '../types';

/**
 * What of the library — and, since 2026-09-23, the account and the latest
 * readings — is written to the device, and what is thrown away.
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
 * Changing `pieceForDisk` below is a trigger; so is a field added to any type
 * saved here — a take, its bars, the readings, a piece, the account — and
 * `persistShape.test.ts` stops compiling until this is bumped. Adding a key
 * root is not, because an unknown key simply never matches.
 *
 * **2, on 2026-09-25, after the app would not start.** Takes gained a tempo
 * per bar and then a pitch reading within three days, and this stayed at 1.
 * A phone that had saved takes from before came back with them missing
 * `intonation` — `undefined`, which the Insights line tested as `!== null`
 * and passed — so the tab the app builds at launch read `.spreadCents` off
 * nothing and threw, on every launch, until the saved readings aged out a day
 * later: the crash left nothing mounted to fetch fresh ones.
 *
 * 3, the same day: bars gained `targetBpm`, the tempo a "meno mosso" sets.
 *
 * 4, 2026-09-26: takes gained `wrongNotes` and `restEntries`.
 */
export const CACHE_SHAPE = 4;

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

type Kind = 'me' | 'list' | 'current' | 'detail' | 'insights' | 'takes';

/**
 * How long a kept reading is still worth showing: a day.
 *
 * Takes and the insights built from them are figures about the musician's
 * playing, and a figure read back from last week with nothing saying so is the
 * thing the original allow-list refused to write. A day old, it is what the
 * screen said last night, shown for the second it takes the refetch to land —
 * which is the whole of what the owner asked for ("stuff that still takes time
 * to load", 2026-09-23). Older than that it is dropped on the way in
 * (`deserializeFromDisk`) and the screen waits for the network as it did.
 */
export const READING_SHELF_LIFE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a query is one of the ones kept, and which kind it is.
 *
 * **An allow-list, not a deny-list.** It was pieces only: the account row was
 * "cheap to refetch" and readings were "a number that would be wrong the
 * moment it was read back". Both costs turned out to be paid on every launch
 * — the whole app waits behind `/v1/me` (`RootNavigator`'s account gate), and
 * Insights opened on a spinner — so the account and the latest readings are
 * kept too, the account without its signed photo URL and the readings for a
 * day (`READING_SHELF_LIFE_MS`). Every one of them refetches on mount; this
 * decides only what is on screen while it does.
 *
 * A piece's take history (`['takes', 'history', id]`) is still not kept: it is
 * per piece, grows without bound, and the piece screen already prefetches it
 * on the way in.
 */
export function persistedKind(queryKey: readonly unknown[]): Kind | null {
  if (queryKey.length === 1 && queryKey[0] === 'me') {
    return 'me';
  }
  if (queryKey.length === 1 && queryKey[0] === 'insights') {
    return 'insights';
  }
  if (queryKey[0] === 'takes') {
    const latest = queryKey.length === 2 && queryKey[1] === 'latest';
    const recent = queryKey.length === 3 && queryKey[1] === 'recent';
    return latest || recent ? 'takes' : null;
  }
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

/** Successful queries of the kinds above, and nothing else. */
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

/**
 * The account, without the one field that cannot survive the trip.
 *
 * `avatarUrl` is signed for an hour, like a piece's thumbnail, and a restored
 * one is a broken image in the one circle every launch shows. `null` draws the
 * initial, which is what the Profile avatar already draws before a photo
 * exists; the refetch puts the photograph back a moment later.
 */
export function musicianForDisk(musician: Musician): Musician {
  return { ...musician, avatarUrl: null };
}

function dataForDisk(kind: Kind, data: unknown): unknown {
  if (kind === 'insights' || kind === 'takes') {
    return data;
  }
  if (kind === 'me') {
    return data && typeof data === 'object' ? musicianForDisk(data as Musician) : data;
  }
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

/**
 * The account first — it is small and the whole app waits on it — then the
 * listing and today's piece, then the readings, then the pieces opened most
 * recently, which are the ones a tight budget trims.
 */
const ORDER: Record<Kind, number> = { me: 0, list: 1, current: 2, insights: 3, takes: 4, detail: 5 };

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

/**
 * The stored cache as it comes back, with readings past their shelf life
 * removed.
 *
 * On the way in rather than the way out, because the way out only runs when
 * something in the cache changes: an app left closed for a week writes nothing
 * in that week, and its last write would come back holding last week's
 * readings. Anything that does not parse is passed through untouched — the
 * library's own restore discards a malformed client, and this is not the place
 * to decide otherwise.
 */
export function deserializeFromDisk(raw: string, now: number): StoredClient {
  const client = JSON.parse(raw) as StoredClient;
  const queries = client?.clientState?.queries;
  if (!Array.isArray(queries)) {
    return client;
  }
  const fresh = queries.filter((query) => {
    const kind = persistedKind(query.queryKey);
    if (kind !== 'insights' && kind !== 'takes') {
      return true;
    }
    return now - (query.state.dataUpdatedAt ?? 0) <= READING_SHELF_LIFE_MS;
  });
  return { ...client, clientState: { ...client.clientState, queries: fresh } };
}
