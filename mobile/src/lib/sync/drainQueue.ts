import type { TakeFailure } from '../audio/takeFailure';
import type { TakeSubmissionState } from '../../data/practice/submitTake';
import {
  dueAt,
  load,
  nextDue,
  recordFailure,
  remove,
  type QueuedTake,
  type TakeStore,
} from './takeQueue';

/**
 * Sending the takes that are waiting.
 *
 * **The queue had no drain.** `takeQueue.ts` persists a take a musician could
 * not send, with backoff (`backoffMs`, `dueAt`, `isDue`), failure accounting
 * (`recordFailure`) and an oldest-first pick (`nextDue`) — all built, all
 * tested, and called by nothing. The only thing that ever sent a queued take
 * was `RecordScreen` restoring it, which requires the musician to remember
 * which piece it was, navigate to that piece's recording screen, and tap.
 *
 * So the honest description of the shipped behaviour was: a take recorded out
 * of signal is *kept*, not *sent*. Three takes across three pieces in one
 * rehearsal meant three deliberate journeys, and nothing anywhere told them
 * so. This module is the missing half — the part that makes "your take is
 * safe" true without the musician doing anything.
 *
 * **Rules here, device there**, the same split as the rest of this directory
 * and for the same reason: there is no React Native testing library in this
 * project (`DECISIONS.md`, 2026-08-24), so a rule living in a screen or in an
 * `AppState` listener is a rule nothing checks. `takeDrainer.ts` binds this to
 * a real store, a real network and a real clock and decides nothing.
 */

export interface DrainDeps {
  store: TakeStore;
  accountId: string;
  /** Send one take. Resolves only once the server has it. */
  submit(take: QueuedTake, audio: Blob): Promise<void>;
  /**
   * How to read a failure — the message a musician would see and whether
   * another attempt could ever succeed.
   *
   * Injected rather than imported so the drain and the recording screen cannot
   * disagree: `readTakeFailure` is the one place that decides `retriable`, and
   * a second copy of that judgement here is how a quota-refused take comes to
   * be retried every five minutes for the rest of the month.
   */
  read(error: unknown): TakeFailure;
  now(): number;
}

/** Why a pass stopped. Every one of these is a different next move. */
export type DrainStop =
  /** Nothing is waiting. */
  | 'empty'
  /** Something is waiting, but its backoff has not elapsed. */
  | 'not-due'
  /** Everything that was due went. */
  | 'drained'
  /** An attempt failed in a way another attempt could fix. */
  | 'failed'
  /** An attempt failed in a way another attempt cannot fix — the quota. */
  | 'blocked'
  /** A malformed or migrated entry claims a different owner. Never send it. */
  | 'account-mismatch';

export interface DrainReport {
  /** Takes the server accepted in this pass. */
  sent: number;
  /** Entries dropped because their bytes were gone. Not takes; rows about takes. */
  discarded: number;
  stopped: DrainStop;
  /**
   * When the earliest remaining take becomes due, or null if none remain.
   *
   * Exported so the caller can schedule one timer instead of polling — the
   * same reason `dueAt` is exported from `takeQueue.ts`. A drain that woke
   * every thirty seconds to find nothing due would cost a musician battery
   * for the privilege of doing nothing.
   */
  nextDueAt: number | null;
}

function earliestDueAt(takes: QueuedTake[]): number | null {
  if (takes.length === 0) {
    return null;
  }
  return takes.reduce((soonest, take) => Math.min(soonest, dueAt(take)), Infinity);
}

/** Whatever progress a failed attempt reached, so the next one does not repay it. */
function resumeFrom(error: unknown): TakeSubmissionState | undefined {
  if (error && typeof error === 'object' && 'resume' in error) {
    const { resume } = error as { resume?: unknown };
    if (resume && typeof resume === 'object') {
      return resume as TakeSubmissionState;
    }
  }
  return undefined;
}

/**
 * Send every take that is due, oldest first, and report where it got to.
 *
 * **One failure ends the pass.** Not one failure per take: the reason a take
 * is in this queue is almost always the connection, and the connection is not
 * a property of the take. Trying the other five would be five more uploads
 * into the same dead link, on a device the musician is carrying.
 *
 * **A take whose bytes are gone is dropped, not attempted.** The container was
 * cleared, or the write failed, or an update moved the directory — the entry
 * is a row about a performance that no longer exists, and submitting it would
 * produce a failure with nothing behind it. `restoreQueuedTake` already draws
 * this line; this draws the same one.
 */
export async function drainTakes(deps: DrainDeps): Promise<DrainReport> {
  const { store, accountId, submit, read, now } = deps;
  let sent = 0;
  let discarded = 0;
  /**
   * **The guard against a store that cannot write.** Every branch below either
   * removes an entry or returns, so the queue strictly shrinks and the loop
   * ends — *provided the writes land*. `takeQueue`'s store adapter swallows
   * its failures by design (see `queuedTakes.ts`), so a full disk would leave
   * `load` returning the same take forever and this loop spinning on it,
   * uploading the same WAV without end. Handling each id once makes that a
   * stopped pass rather than a runaway.
   */
  const handled = new Set<string>();

  for (;;) {
    const { takes } = await load(store);
    if (takes.length === 0) {
      return { sent, discarded, stopped: 'empty', nextDueAt: null };
    }

    const take = nextDue(takes, now());
    if (!take || handled.has(take.id)) {
      return {
        sent,
        discarded,
        stopped: sent > 0 ? 'drained' : 'not-due',
        nextDueAt: earliestDueAt(takes),
      };
    }
    handled.add(take.id);

    if (take.accountId !== accountId) {
      return { sent, discarded, stopped: 'account-mismatch', nextDueAt: null };
    }

    const audio = await store.getAudio(take.audioName);
    if (!audio) {
      await remove(store, take.id);
      discarded += 1;
      continue;
    }

    try {
      await submit(take, audio);
      await remove(store, take.id);
      sent += 1;
    } catch (error) {
      const failure = read(error);
      const after = await recordFailure(store, take.id, {
        at: now(),
        error: failure.message,
        resume: resumeFrom(error),
      });
      return {
        sent,
        discarded,
        stopped: failure.retriable ? 'failed' : 'blocked',
        nextDueAt: earliestDueAt(after),
      };
    }
  }
}
