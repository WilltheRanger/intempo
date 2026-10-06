/**
 * The names a queued take is kept under, on every platform.
 *
 * Shared by the native store (files) and the web store (IndexedDB) so the two
 * refuse the same things: an account id that is not a UUID could address
 * another account's queue, and an audio name with a slash could address a
 * file outside the queue's own folder.
 */

/** The AsyncStorage key for one account's queue entries. */
export function takeQueueKey(accountId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) {
    throw new Error('Invalid account ID');
  }
  return `intempo.take-queue.v2.${accountId}`;
}

/** A queued take's audio name, checked: letters, digits, `_.-` and `.wav`. */
export function checkedAudioName(name: string): string {
  if (!/^[a-zA-Z0-9_.-]+\.wav$/.test(name)) {
    throw new Error('Invalid queued audio name');
  }
  return name;
}
