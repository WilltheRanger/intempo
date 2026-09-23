import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { persistQueryClient, type PersistedClient } from '@tanstack/react-query-persist-client';
import type { QueryClient } from '@tanstack/react-query';

import { IS_LIVE_BACKEND } from '../environment';
import { isolatedListener } from '../auth/isolatedListener';
import { getSupabaseClient } from '../auth/session';
import {
  CACHE_KEY,
  MAX_AGE_MS,
  busterFor,
  deserializeFromDisk,
  serializeForDisk,
  shouldPersist,
} from './persistCache';

/**
 * The library cache, bound to this device and this account.
 *
 * Glue, deliberately — the same split as `lib/sync/takeDrainer`: every rule
 * about *what* is written, what is stripped from it and how much of it fits
 * lives in `persistCache.ts`, tested. Nothing here decides anything. What is
 * here is the two facts only a running app knows: which storage this platform
 * has, and who is signed in.
 */

/**
 * How long to sit on a change before writing.
 *
 * A second. Opening the library fires the listing, the current piece and — as
 * the musician taps through — a detail query each, and each one settling is a
 * cache event. Writing on every one of them would serialise the whole library
 * several times in a second, on the same thread that is drawing the screen.
 */
const THROTTLE_MS = 1000;

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: CACHE_KEY,
  throttleTime: THROTTLE_MS,
  // The whole client, not a query's data: every rule turns on which query it
  // is, and the library's own `serializeData` hook is handed data with no key.
  serialize: (client) => serializeForDisk(client),
  // Readings past their shelf life are judged here, on the way in — see
  // `deserializeFromDisk` for why the way out cannot.
  deserialize: (raw) => deserializeFromDisk(raw, Date.now()) as PersistedClient,
});

let stop: (() => void) | null = null;
let persistingFor: string | null = null;

function stopPersisting(): void {
  stop?.();
  stop = null;
  persistingFor = null;
}

/**
 * Keeps the repertoire readable without a connection.
 *
 * **Started per account, and restarted when the account changes.** The buster
 * carries the account id, so a restore that finds somebody else's library
 * removes it rather than hydrating it — but that check only happens at restore,
 * which is why signing in as a different musician has to start a new one rather
 * than carry on writing into the old one.
 *
 * **Signing out removes the file and empties the cache.** Three screens already
 * called `queryClient.clear()` after signing out, and the one sign-out that is
 * not a screen — `apiFetch` doing it for you when the API answers 401 — did
 * not. In memory that gap was invisible, because the cache dies with the
 * process. On disk it is somebody's repertoire left behind on a shared browser,
 * so the rule moves here, to the one place every sign-out passes through.
 *
 * A fixture build persists nothing: the sample library belongs to nobody, its
 * images are bundled assets rather than signed URLs, and there is no account to
 * key it to.
 *
 * @returns a function that stops persisting — `App`'s effect cleanup.
 */
export function startLibraryCache(queryClient: QueryClient): () => void {
  if (!IS_LIVE_BACKEND) {
    return () => {};
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return () => {};
  }

  function follow(accountId: string | undefined): void {
    if (!accountId) {
      if (persistingFor !== null) {
        stopPersisting();
        queryClient.clear();
      }
      void persister.removeClient();
      return;
    }
    if (persistingFor === accountId) {
      return;
    }
    stopPersisting();
    persistingFor = accountId;
    const [unsubscribe] = persistQueryClient({
      queryClient,
      persister,
      buster: busterFor(accountId),
      maxAge: MAX_AGE_MS,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) =>
          shouldPersist(query.queryKey, query.state.status),
        shouldDehydrateMutation: () => false,
      },
    });
    stop = unsubscribe;
  }

  void supabase.auth.getSession().then(({ data }) => follow(data.session?.user?.id));
  // `isolatedListener` for the reason in its own file: this runs inside
  // `signInWithPassword`, and a cache that fails to start must not be reported
  // to the musician as a sign-in that failed.
  const { data } = supabase.auth.onAuthStateChange(
    isolatedListener((_event, session) => follow(session?.user?.id)),
  );

  return () => {
    data.subscription.unsubscribe();
    stopPersisting();
  };
}
