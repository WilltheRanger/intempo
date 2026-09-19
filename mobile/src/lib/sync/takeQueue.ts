import type { TakeSubmissionState } from '../../data/practice/submitTake';
import type { MetronomeMode } from '../../data/types';

/**
 * Takes recorded and not yet accepted by the server.
 *
 * **What this replaces.** `RecordScreen` holds an unsent take in a `useRef` —
 * so a failed submission survives a retry, and does not survive the app being
 * killed. A musician who records in a practice room with no signal, backgrounds
 * the app and comes back has lost the performance, and the performance is the
 * one part of this that cannot be repeated. Batch 10's Definition of Done says
 * *"queue persists across app kills"*; this is that half of it.
 *
 * **Not `pending_uploads`.** Migration 014 has a table of that name and it is a
 * different thing entirely: storage objects on the server with no row pointing
 * at them yet, swept by the backend. Naming this the same would be one grep
 * away from a very confusing hour.
 *
 * **The rules are here and the storage is injected.** There is no React Native
 * testing library in this project (`DECISIONS.md`, 2026-08-24), so a rule that
 * only runs against a real device store is a rule nothing checks — and the
 * capture-path audit found eight of its nine defects in exactly that layer.
 * `takeQueue.store.ts` is the adapter; everything decided is here.
 */

/** Everything `submitTake` needs, minus the bytes. */
export interface QueuedTake {
  /** Local, ours, and stable across restarts. Not the analysis id. */
  id: string;
  /** Supabase auth user id. Never submit under a different session. */
  accountId: string;
  scoreId: string;
  targetBpm: number;
  metronomeMode: MetronomeMode;
  /** The name the WAV is uploaded under — `takeFilename`'s output. */
  filename: string;
  skipLongRests: boolean;
  fromMeasure: number | null;
  /**
   * Progress from an earlier attempt, and the reason this queue can be drained
   * safely.
   *
   * `submitTake` reuses a server-issued `audioKey` rather than uploading again,
   * and returns an existing `analysisId` rather than creating a second. Without
   * carrying it, draining is how a musician pays twice out of three free
   * monthly analyses for one performance — the spec's own idempotency pitfall,
   * with the mechanism already built and only needing to survive a restart.
   */
  resume: TakeSubmissionState;
  attempts: number;
  /** Null until the first attempt. Milliseconds. */
  lastAttemptAt: number | null;
  /** The last failure as a musician would read it. Never the raw error. */
  lastError: string | null;
  createdAt: number;
  /**
   * Where the bytes are, **relative** — a name, never a path.
   *
   * iOS rotates the app container's directory on update, so an absolute path
   * stored today does not exist after the next release. The spec names this
   * pitfall, and it is the one that loses every queued take at once, silently,
   * on the day everybody updates.
   */
  audioName: string;
}

/** What the queue needs from a device. `takeQueue.store.ts` implements it. */
export interface TakeStore {
  read(): Promise<unknown>;
  write(items: QueuedTake[]): Promise<void>;
  putAudio(name: string, audio: Blob): Promise<void>;
  /** Null when the bytes are gone — a cleared container, a failed write. */
  getAudio(name: string): Promise<Blob | null>;
  deleteAudio(name: string): Promise<void>;
}

/** A take on its way in, before the queue gives it an identity. */
export type NewTake = Omit<
  QueuedTake,
  'id' | 'attempts' | 'lastAttemptAt' | 'lastError' | 'createdAt' | 'audioName'
> & { audio: Blob };

/**
 * How long to wait before a queued take is worth trying again.
 *
 * Doubling from ten seconds, capped at five minutes. **The cap matters more
 * than the curve**: a musician who has just walked back into signal should not
 * be waiting an hour because the app failed four times in a tunnel.
 */
export function backoffMs(attempts: number): number {
  const FIRST = 10_000;
  const CAP = 5 * 60_000;
  return Math.min(CAP, FIRST * 2 ** Math.max(0, attempts - 1));
}

/** When a take next becomes due. Exported so a caller can schedule, not poll. */
export function dueAt(take: QueuedTake): number {
  if (take.lastAttemptAt === null) {
    return take.createdAt;
  }
  return take.lastAttemptAt + backoffMs(take.attempts);
}

/** Whether this take is worth another attempt yet. */
export function isDue(take: QueuedTake, now: number): boolean {
  return now >= dueAt(take);
}

/**
 * Whether a stored object is a take this build can still submit.
 *
 * Storage outlives the code that wrote it. A shape from an older version that
 * is read as valid produces a submission missing a field the server now
 * requires, which fails for a reason no message explains; one that is silently
 * dropped costs a musician a performance. Read strictly, and the caller says
 * which of those two it prefers — `load` keeps what it can and reports the
 * rest.
 */
function valid(value: unknown): value is QueuedTake {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const t = value as Partial<QueuedTake>;
  return (
    typeof t.id === 'string' && t.id.length > 0 &&
    typeof t.accountId === 'string' && t.accountId.length > 0 &&
    typeof t.scoreId === 'string' && t.scoreId.length > 0 &&
    typeof t.targetBpm === 'number' && Number.isFinite(t.targetBpm) &&
    typeof t.filename === 'string' && t.filename.length > 0 &&
    typeof t.audioName === 'string' && t.audioName.length > 0 &&
    typeof t.attempts === 'number' && Number.isFinite(t.attempts) &&
    typeof t.createdAt === 'number' && Number.isFinite(t.createdAt) &&
    (t.lastAttemptAt === null || typeof t.lastAttemptAt === 'number') &&
    (t.lastError === null || typeof t.lastError === 'string') &&
    (t.fromMeasure === null || typeof t.fromMeasure === 'number') &&
    typeof t.resume === 'object' && t.resume !== null
  );
}

/** Everything a load found, including what it could not use. */
export interface LoadedQueue {
  takes: QueuedTake[];
  /**
   * How many stored entries this build could not read.
   *
   * Reported rather than swallowed: it is the number of performances that are
   * on the device and will never be sent, and a count of them belongs in front
   * of somebody rather than in a log nobody reads.
   */
  unreadable: number;
}

export async function load(store: TakeStore): Promise<LoadedQueue> {
  let raw: unknown;
  try {
    raw = await store.read();
  } catch {
    return { takes: [], unreadable: 0 };
  }
  if (!Array.isArray(raw)) {
    return { takes: [], unreadable: 0 };
  }
  const takes = raw.filter(valid);
  return { takes, unreadable: raw.length - takes.length };
}

/**
 * Put a take in the queue.
 *
 * **The bytes are written before the entry**, and that order is the whole
 * safety of it: an entry pointing at bytes that were never written is a take
 * the musician can see and can never send, while bytes with no entry are one
 * orphaned file the next enqueue's sweep removes. The same ordering rule the
 * server's `pending_uploads` uses, one layer down.
 */
export async function enqueue(
  store: TakeStore,
  take: NewTake,
  now: number,
  id: string,
): Promise<QueuedTake[]> {
  const audioName = `${id}.wav`;
  await store.putAudio(audioName, take.audio);

  const { audio: _audio, ...rest } = take;
  const entry: QueuedTake = {
    ...rest,
    id,
    audioName,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    createdAt: now,
  };
  const { takes } = await load(store);
  const next = [...takes, entry];
  await store.write(next);
  return next;
}

/**
 * Take one out — it was accepted, or the musician discarded it.
 *
 * The entry goes first and the bytes after, the mirror of `enqueue` and for the
 * mirror reason: an entry removed first leaves a file the next sweep collects,
 * where bytes removed first would leave an entry pointing at nothing.
 */
export async function remove(
  store: TakeStore,
  id: string,
): Promise<QueuedTake[]> {
  const { takes } = await load(store);
  const going = takes.find((t) => t.id === id);
  const next = takes.filter((t) => t.id !== id);
  await store.write(next);
  if (going) {
    try {
      await store.deleteAudio(going.audioName);
    } catch {
      // A file the system will clear anyway. Losing the entry is the part
      // that matters, and it is already done.
    }
  }
  return next;
}

/**
 * Drop every take waiting for one piece, bytes and all.
 *
 * **For a piece the musician deleted.** Nothing did this, and the entry that
 * was left behind is worse than a leak. Its WAV — up to `MAX_UPLOAD_BYTES`,
 * which is 50 MB — stays on the device for the life of the install, because
 * the only thing that drops an entry unasked is `restoreQueuedTake` noticing
 * the *bytes* are gone, and they are not.
 *
 * And it is not inert. `submitTake` needs a `scoreId`; the server answers 404
 * for a score that no longer exists, which `readTakeFailure` reads as
 * retriable — correctly, since it cannot tell a deleted piece from a bad
 * moment. So the drain retries it on every foreground for ever. Worse, a pass
 * **stops at the first failure** by design, because the usual reason a take is
 * queued is the connection rather than the take — so one dead entry sits at
 * the head of the queue and blocks every real take behind it.
 *
 * Deleting these is not a judgement about a musician's recording: they deleted
 * the piece, and a take of a piece that does not exist can be neither analysed
 * nor shown.
 */
export async function removeForScore(
  store: TakeStore,
  scoreId: string,
): Promise<QueuedTake[]> {
  const { takes } = await load(store);
  const going = takes.filter((take) => take.scoreId === scoreId);
  if (going.length === 0) {
    // Nothing to do, and no write: the common case is a piece with no queued
    // take at all, and rewriting the file for it would be a write per delete.
    return takes;
  }
  const next = takes.filter((take) => take.scoreId !== scoreId);
  // The entries first, then the bytes — the same order `remove` uses, and for
  // the same reason: an entry removed first leaves a file the next sweep
  // collects, where bytes removed first would leave an entry pointing at
  // nothing.
  await store.write(next);
  for (const take of going) {
    try {
      await store.deleteAudio(take.audioName);
    } catch {
      // A file the system will clear anyway. Losing the entry is the part that
      // matters, and it is already done.
    }
  }
  return next;
}

/**
 * Record that an attempt failed, keeping whatever progress it made.
 *
 * `resume` is merged rather than replaced: an attempt that uploaded the audio
 * and then failed to create the analysis has earned the `audioKey`, and
 * throwing it away means the next attempt sends the whole WAV again over the
 * connection that just failed.
 */
export async function recordFailure(
  store: TakeStore,
  id: string,
  { at, error, resume }: { at: number; error: string; resume?: TakeSubmissionState },
): Promise<QueuedTake[]> {
  const { takes } = await load(store);
  const next = takes.map((take) =>
    take.id === id
      ? {
          ...take,
          attempts: take.attempts + 1,
          lastAttemptAt: at,
          lastError: error,
          resume: { ...take.resume, ...(resume ?? {}) },
        }
      : take,
  );
  await store.write(next);
  return next;
}

/**
 * The next take worth attempting, or null.
 *
 * Oldest first, so a queue that builds up during a rehearsal drains in the
 * order it was played rather than newest-first — a musician looking at their
 * history should see the session, not a reversal of it.
 */
export function nextDue(takes: QueuedTake[], now: number): QueuedTake | null {
  const due = takes.filter((take) => isDue(take, now));
  if (due.length === 0) {
    return null;
  }
  return due.reduce((oldest, take) =>
    take.createdAt < oldest.createdAt ? take : oldest,
  );
}
