/**
 * A recording the musician already has, on its way from the Upload screen to
 * the Record screen that sends it.
 *
 * **Record keeps sending; Upload only chooses.** Sending a take is the upload,
 * the enqueue, the wait with its progress bar, the failures, "Send it again",
 * the offline queue — all of it lives on Record, and a second copy on Upload
 * would be a second place for it to go wrong. So the redesign's Upload screen
 * (`redesign/UploadRecording.dc.html`) holds a picked file here while the
 * musician looks at it, and "Send for analysis" queues it for Record to pick up
 * when it comes back into focus.
 *
 * In memory, per piece, and deliberately not persisted: a picked file is a
 * handle the picker gave this session. If the app is killed before it is sent
 * nothing is lost that the musician does not still have — it is their file.
 */

export interface PickedFile {
  audio: Blob;
  /** The name as the musician saw it in the picker. */
  name: string;
  /** What it is uploaded as — `describePickedTake`'s output. */
  filename: string;
  contentType: string;
  /** Null when the picker did not say. */
  sizeBytes: number | null;
}

export interface QueuedPickedTake {
  file: PickedFile;
  /** The bar the recording starts on, as chosen on the Upload screen. */
  fromMeasure: number;
}

const staged = new Map<string, PickedFile>();
const outgoing = new Map<string, QueuedPickedTake>();

/** Hold a file for the Upload screen to show. Replaces one already held. */
export function stagePickedFile(pieceId: string, file: PickedFile): void {
  staged.set(pieceId, file);
}

/** The file being looked at for this piece, if there is one. */
export function stagedPickedFile(pieceId: string): PickedFile | null {
  return staged.get(pieceId) ?? null;
}

/** Let the file go without sending it — Back from the Upload screen. */
export function clearPickedFile(pieceId: string): void {
  staged.delete(pieceId);
}

/**
 * "Send for analysis": move the held file to the queue Record reads. Returns
 * false when there was nothing held, so the caller does not navigate away
 * promising a send that cannot happen.
 */
export function queuePickedFileForSend(pieceId: string, fromMeasure: number): boolean {
  const file = staged.get(pieceId);
  if (!file) {
    return false;
  }
  staged.delete(pieceId);
  outgoing.set(pieceId, { file, fromMeasure });
  return true;
}

/** Take the queued file, once — Record calls this when it regains focus. */
export function takeQueuedPickedFile(pieceId: string): QueuedPickedTake | null {
  const queued = outgoing.get(pieceId) ?? null;
  outgoing.delete(pieceId);
  return queued;
}
