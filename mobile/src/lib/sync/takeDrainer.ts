import { AppState, Platform } from 'react-native';

import { getAccessToken, getActiveAccountId } from '../../data/auth/session';
import { takeSubmissionSource } from '../../data/sources';
import { readTakeFailure } from '../audio/takeFailure';
import { drainTakes, type DrainReport } from './drainQueue';
import { deviceTakeStoreFor } from './takeQueue.store';

/**
 * The drain, bound to this device.
 *
 * Glue, deliberately — the same split as `queuedTakes.ts`: every rule about
 * what to send, in what order, and what a failure means lives in
 * `drainQueue.ts` where it is tested against a fake store and a fake clock.
 * Nothing here decides anything. What is here is the three facts only a
 * running app knows: whether anyone is signed in, when the app came back to
 * the foreground, and what the clock says.
 */

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function cancelTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Come back when the earliest take is due, rather than polling for it.
 *
 * `blocked` gets no timer: the quota does not move until next month, so a
 * timer would be an alarm set to re-earn the same refusal. That case waits for
 * the next foreground, which is a person doing something, not a clock.
 */
function scheduleNext(report: DrainReport): void {
  cancelTimer();
  if (report.stopped === 'blocked' || report.stopped === 'account-mismatch' || report.nextDueAt === null) {
    return;
  }
  const wait = Math.max(1_000, report.nextDueAt - Date.now());
  timer = setTimeout(() => {
    timer = null;
    void drainNow();
  }, wait);
}

/**
 * Send whatever is waiting, if anything is and if anyone can.
 *
 * **Signed out is a skip, not an attempt.** Every take would answer 401, and a
 * 401 is retriable, so attempting would burn the backoff on a queue that
 * cannot go anywhere — and leave the musician's last error saying their
 * session had ended when what they need to know is that their take is safe.
 *
 * **Never two at once.** A foreground and a due timer can land together, and
 * two passes over one queue is two uploads of one WAV — the exact thing the
 * queue's `resume` field exists to prevent.
 */
async function drainNow(): Promise<DrainReport | null> {
  if (running) {
    return null;
  }
  running = true;
  try {
    if ((await getAccessToken()) === null) {
      return null;
    }
    const accountId = await getActiveAccountId();
    if (!accountId) return null;
    const report = await drainTakes({
      store: deviceTakeStoreFor(accountId),
      accountId,
      submit: async (take, audio) => {
        if (take.accountId !== accountId) {
          throw new Error('Queued take belongs to another account');
        }
        const assertOwner = async () => {
          if (await getActiveAccountId() !== accountId) {
            throw new Error('Account changed while sending a queued take');
          }
        };
        await assertOwner();
        await takeSubmissionSource.submit({
          scoreId: take.scoreId,
          targetBpm: take.targetBpm,
          metronomeMode: take.metronomeMode,
          audio,
          filename: take.filename,
          resume: take.resume,
          skipLongRests: take.skipLongRests,
          fromMeasure: take.fromMeasure,
          assertOwner,
        });
      },
      read: (error) => readTakeFailure(error, Platform.OS),
      now: () => Date.now(),
    });
    scheduleNext(report);
    return report;
  } catch {
    // The drain is a background courtesy; it must never be the reason the app
    // stops. `drainTakes` handles a failed *submission* itself — reaching here
    // means the store or the session read threw, and the next foreground is a
    // better answer than a retry loop over a device that is not answering.
    return null;
  } finally {
    running = false;
  }
}

/**
 * Start draining, and keep draining as the app comes and goes.
 *
 * Foreground is the trigger that matters. A musician who recorded with no
 * signal puts the phone away; what changes is not a timer firing but them
 * walking back into coverage and opening something — and `active` is the
 * closest this app gets to knowing that happened.
 */
export function startTakeDrainer(): () => void {
  void drainNow();
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void drainNow();
    }
  });
  return () => {
    subscription.remove();
    cancelTimer();
  };
}
