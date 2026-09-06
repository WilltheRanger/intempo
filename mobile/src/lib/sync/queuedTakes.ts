import type { TakeSubmissionState } from '../../data/practice/submitTake';
import type { MetronomeMode } from '../../data/types';
import { deviceTakeStore } from './takeQueue.store';
import { enqueue, load, remove, type QueuedTake } from './takeQueue';

/**
 * The three things `RecordScreen` does with the queue, bound to the device.
 *
 * Glue, deliberately: the rules are in `takeQueue.ts` where they are tested
 * against a fake store, the storage is in `takeQueue.store.ts`, and the screen
 * calls three named functions rather than assembling either. Nothing here
 * decides anything.
 *
 * **Every one of them swallows its failure.** The queue exists to make a take
 * survive; a queue that throws on the way past would take down the submission
 * it is trying to protect, which is worse than the memory-only behaviour it
 * replaces. Failing to persist costs the app kill; failing loudly costs the
 * take.
 */

/** What the queue needs beyond the bytes, from the screen that recorded them. */
export interface TakeContext {
  scoreId: string;
  targetBpm: number;
  metronomeMode: MetronomeMode;
  skipLongRests: boolean;
  fromMeasure: number | null;
}

/**
 * The id is the take's own name, minus the extension.
 *
 * `takeFilename` is a timestamp to the millisecond, so it is already unique per
 * take and already the name the WAV is uploaded under. Generating a second
 * identity would mean two things to keep in step for no gain.
 */
function idFor(filename: string): string {
  return filename.replace(/\.wav$/i, '');
}

/** Hold a take that could not be sent, so an app kill does not lose it. */
export async function keepTakeForLater(
  recording: { audio: Blob; filename: string; resume?: TakeSubmissionState },
  context: TakeContext,
  lastError: string,
): Promise<void> {
  try {
    const id = idFor(recording.filename);
    await remove(deviceTakeStore, id);
    const queued = await enqueue(
      deviceTakeStore,
      {
        ...context,
        filename: recording.filename,
        resume: recording.resume ?? {},
        audio: recording.audio,
      },
      Date.now(),
      id,
    );
    // The reason belongs on the entry, so a take restored after a restart can
    // say why it is still here rather than reappearing unexplained.
    const entry = queued.find((take) => take.id === id);
    if (entry) {
      entry.lastError = lastError;
      await deviceTakeStore.write(queued);
    }
  } catch {
    // See the module docstring: never at the cost of the submission.
  }
}

/** The server has it. Drop the copy. */
export async function takeWasAccepted(filename: string): Promise<void> {
  try {
    await remove(deviceTakeStore, idFor(filename));
  } catch {
    // A stale entry is recovered by the next restore, which reads the bytes
    // and finds them; leaving one behind costs a little disk, not a take.
  }
}

/** A take for this piece that an earlier session could not send, with its bytes. */
export interface RestoredTake {
  audio: Blob;
  filename: string;
  resume: TakeSubmissionState;
  lastError: string | null;
}

/**
 * Bring back the unsent take for one piece, if there is one.
 *
 * **The bytes are what decides it.** An entry whose file is gone — a cleared
 * container, a failed write, an upgrade that moved the directory — is not a
 * take, it is a row about one, and offering "Send it again" for it would
 * produce a failure with nothing behind it. Such an entry is dropped here
 * rather than shown.
 */
export async function restoreQueuedTake(
  scoreId: string,
): Promise<RestoredTake | null> {
  try {
    const { takes } = await load(deviceTakeStore);
    const mine = takes
      .filter((take: QueuedTake) => take.scoreId === scoreId)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const take of mine) {
      const audio = await deviceTakeStore.getAudio(take.audioName);
      if (audio) {
        return {
          audio,
          filename: take.filename,
          resume: take.resume,
          lastError: take.lastError,
        };
      }
      await remove(deviceTakeStore, take.id);
    }
    return null;
  } catch {
    return null;
  }
}
